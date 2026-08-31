// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { registerMonths, registerPage } from '$lib/server/transactions';
import { loanPaymentByTransaction } from '$lib/server/loans/payments';
import { DEFAULT_PAGE_SIZE, type RegisterFilter } from '$lib/transactions/filter';
import { rowId } from '../row-id';

/**
 * W2.2: a stage of the waterfall is a group, and clicking one asks the register
 * for the categories inside it.
 *
 * The register could already be narrowed to one category. A group is a
 * different question — "everything filed under Housing" — and it has to be
 * answered on the same effective lines the rest of the filter uses, or a split
 * transaction with one housing line would either drop out of the list or bring
 * its whole amount into the total.
 */

let harness: Harness;
let testDb: TestDb;

const ACCOUNT = rowId('register-group-account');

const filter = (overrides: Partial<RegisterFilter> = {}): RegisterFilter => ({
	search: null,
	from: null,
	to: null,
	accountId: null,
	categoryId: null,
	groupKey: null,
	direction: 'any',
	minMinor: null,
	maxMinor: null,
	baseCurrency: 'CZK',
	reviewState: null,
	tagId: null,
	includeTransfers: false,
	sourceMethod: null,
	month: null,
	page: 1,
	pageSize: DEFAULT_PAGE_SIZE,
	...overrides
});

beforeAll(async () => {
	harness = await startPostgres('register-group');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 60_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql.unsafe(`
		truncate table transaction_split, "transaction", category, account, entity
			restart identity cascade;
		insert into account (id, name, currency, bank)
			values ('${ACCOUNT}', 'Current', 'CZK', 'fio');
		-- Two categories in one group and one in another: the point of the filter
		-- is that it takes the first two together and leaves the third alone.
		insert into category (id, group_key, name) values
			('mortgage', 'housing', 'Mortgage'),
			('svj', 'housing', 'SVJ & insurance'),
			('groceries', 'living', 'Groceries'),
			('salary', 'income', 'Salary');

		insert into "transaction"
			(id, dedup_fingerprint, account_id, booked_on, amount_minor, fee_minor, currency, category_id, review_state)
		values
			('${rowId('may-pay')}', '${rowId('may-pay')}', '${ACCOUNT}', '2026-05-29', 30000, null, 'CZK', 'salary', 'confirmed'),
			-- The fee comes off the line it belongs to, exactly as every other
			-- register total takes it: 10 000 out plus 100 of fee.
			('${rowId('jun-mortgage')}', '${rowId('jun-mortgage')}', '${ACCOUNT}', '2026-06-01', -10000, 100, 'CZK', 'mortgage', 'confirmed'),
			('${rowId('jun-svj')}', '${rowId('jun-svj')}', '${ACCOUNT}', '2026-06-02', -2000, null, 'CZK', 'svj', 'confirmed'),
			('${rowId('jun-shop')}', '${rowId('jun-shop')}', '${ACCOUNT}', '2026-06-03', -5000, null, 'CZK', 'groceries', 'confirmed'),
			('${rowId('jun-mixed')}', '${rowId('jun-mixed')}', '${ACCOUNT}', '2026-06-04', -8000, null, 'CZK', null, 'confirmed');

		-- A shop run with a housing line inside it, so the group filter has to
		-- select the transaction and sum only the line that belongs to it.
		insert into transaction_split (id, transaction_id, amount_minor, category_id, sort) values
			('${rowId('mixed-groceries')}', '${rowId('jun-mixed')}', -3000, 'groceries', 0),
			('${rowId('mixed-svj')}', '${rowId('jun-mixed')}', -5000, 'svj', 1);
	`);
});

describe('the group filter', () => {
	it('takes every category in the group and nothing outside it', async () => {
		const housing = await registerPage(filter({ groupKey: 'housing' }), testDb);

		expect(housing.rows.map((row) => row.id)).toEqual([
			rowId('jun-mixed'),
			rowId('jun-svj'),
			rowId('jun-mortgage')
		]);
		expect(housing.total).toBe(3);
		// 10 100 + 2 000 + the 5 000 housing line of the mixed row — not its
		// whole 8 000, and not the groceries beside it.
		expect(housing.totals).toEqual([{ currency: 'CZK', sumMinor: -17100n }]);
	});

	it('leaves the rows of another group out of it', async () => {
		const living = await registerPage(filter({ groupKey: 'living' }), testDb);

		expect(living.rows.map((row) => row.id)).toEqual([rowId('jun-mixed'), rowId('jun-shop')]);
		expect(living.totals).toEqual([{ currency: 'CZK', sumMinor: -8000n }]);
	});

	// Two questions, not one asked twice: the group says which part of the
	// waterfall, the category says which line of it.
	it('narrows further when a category is asked for as well', async () => {
		const both = await registerPage(filter({ groupKey: 'housing', categoryId: 'svj' }), testDb);

		expect(both.rows.map((row) => row.id)).toEqual([rowId('jun-mixed'), rowId('jun-svj')]);
		expect(both.totals).toEqual([{ currency: 'CZK', sumMinor: -7000n }]);
	});

	it('selects nothing for a group nobody has', async () => {
		const none = await registerPage(filter({ groupKey: 'no-such-group' }), testDb);

		expect(none.rows).toEqual([]);
		expect(none.total).toBe(0);
		expect(none.totals).toEqual([]);
	});

	// The month rows are summed from the same effective lines, so the register's
	// own footing and the month it lists agree rather than being two answers.
	it('is honoured by the month totals, on the same effective lines', async () => {
		const months = await registerMonths(filter({ groupKey: 'housing' }), testDb);

		// May held only pay, so it drops out entirely rather than reporting zero.
		expect(months.map((m) => m.month)).toEqual(['2026-06']);
		expect(months[0].count).toBe(3);
		expect(months[0].byCurrency).toEqual([
			{ currency: 'CZK', inMinor: 0n, outMinor: 17100n, sumMinor: -17100n }
		]);
	});

	it('changes nothing when it is not asked for', async () => {
		const all = await registerPage(filter(), testDb);

		expect(all.total).toBe(5);
		expect(all.totals).toEqual([{ currency: 'CZK', sumMinor: 4900n }]);
	});
});

/**
 * The window is measured on the day the money moved.
 *
 * The chart sums on the value date where the bank prints one, and every band
 * links back here. A card payment started in June and booked in July was
 * counted in June's band and then missing from the June list that band opened,
 * which is one figure disagreeing with the list behind it.
 */
describe('the effective date', () => {
	beforeEach(async () => {
		await harness.sql.unsafe(`
			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_on, value_on, amount_minor, currency, category_id, review_state)
			values
				('${rowId('straddle')}', '${rowId('straddle')}', '${ACCOUNT}', '2026-07-02', '2026-06-28', -1500, 'CZK', 'groceries', 'confirmed');
		`);
	});

	it('files a row under the month the money moved in, not the month the bank booked it', async () => {
		const months = await registerMonths(filter(), testDb);

		// July holds nothing at all: the only row booked in it moved in June.
		expect(months.map((m) => m.month)).toEqual(['2026-06', '2026-05']);
		const june = months.find((m) => m.month === '2026-06');
		expect(june?.count).toBe(5);
		expect(june?.byCurrency).toEqual([
			{ currency: 'CZK', inMinor: 0n, outMinor: 26600n, sumMinor: -26600n }
		]);
	});

	it('returns it from the month row it was filed under', async () => {
		const june = await registerPage(filter({ month: '2026-06' }), testDb);

		expect(june.rows.map((row) => row.id)).toContain(rowId('straddle'));
		expect(june.total).toBe(5);

		// And not from the month the bank happens to have booked it in.
		const july = await registerPage(filter({ month: '2026-07' }), testDb);
		expect(july.rows).toEqual([]);
	});

	// The date on the row is the date it is now filed under; the booking date is
	// carried beside it rather than dropped, because the bank printed both.
	it('shows the effective date and keeps the booked one', async () => {
		const june = await registerPage(filter({ month: '2026-06' }), testDb);
		const straddle = june.rows.find((row) => row.id === rowId('straddle'));

		expect(straddle?.effectiveAt).toBe('2026-06-28');
		expect(straddle?.bookedAt).toBe('2026-07-02');
	});
});

/**
 * The two halves are worked out twice — once in SQL for the totals, once in
 * TypeScript for the panel that explains them — and they have to land on the
 * same minor unit.
 *
 * The figures here are the only shape that can catch it: the exact interest is
 * 20 017.5, a half-way tie, and a tie is where two roundings part company. The
 * fee is what produces it, by making the line the halves are taken from
 * something other than the amount the loan event was recorded against.
 */
describe('a loan payment whose halves land on a half-way tie', () => {
	beforeEach(async () => {
		await harness.sql.unsafe(`
			insert into category (id, group_key, name) values
				('loan-principal', 'savings', 'Loan principal');

			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_on, amount_minor, fee_minor, currency, category_id, review_state)
			values
				('${rowId('jun-tie')}', '${rowId('jun-tie')}', '${ACCOUNT}', '2026-06-20', -2400000, 2100, 'CZK', 'mortgage', 'confirmed');

			insert into loan (id, name, currency, principal_minor, owed_minor)
				values ('${rowId('tie-loan')}', 'Karlín', 'CZK', 5000000, 4120000);
			insert into loan_event (id, loan_id, happened_on, kind, amount_minor, interest_minor, transaction_id)
				values (
					'${rowId('tie-claim')}',
					'${rowId('tie-loan')}',
					'2026-06-20', 'payment', 2400000, 20000,
					'${rowId('jun-tie')}'
				);
		`);
	});

	// −2 402 100 × 20 000 / 2 400 000 is exactly −20 017.5, which rounds away
	// from zero to −20 018. Dividing before multiplying loses the tie: the ratio
	// is no longer exact and the product falls a hair short of the half.
	it('rounds the tie the same way in the totals and in the row', async () => {
		const housing = await registerPage(filter({ groupKey: 'housing' }), testDb);
		const savings = await registerPage(filter({ groupKey: 'savings' }), testDb);
		const claims = await loanPaymentByTransaction([rowId('jun-tie')], testDb);

		// The 17 100 the other housing rows come to, plus the interest half.
		expect(housing.totals).toEqual([{ currency: 'CZK', sumMinor: -37118n }]);
		expect(savings.totals).toEqual([{ currency: 'CZK', sumMinor: -2382082n }]);
		expect(claims.get(rowId('jun-tie'))?.halves).toEqual({
			interestMinor: -20018n,
			principalMinor: -2382082n,
			principalLabel: 'Loan principal'
		});
	});
});

/**
 * A claimed instalment is two lines, and each group sees only its own.
 *
 * The chart moves the interest into the group the payment is filed under and
 * the principal into savings. Until the register expressed the same split, the
 * housing band said one thing and the list it opened said the whole debit.
 */
describe('a loan payment with a stated interest', () => {
	beforeEach(async () => {
		await harness.sql.unsafe(`
			insert into category (id, group_key, name) values
				('loan-principal', 'savings', 'Loan principal');

			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_on, amount_minor, currency, category_id, review_state)
			values
				('${rowId('jun-instalment')}', '${rowId('jun-instalment')}', '${ACCOUNT}', '2026-06-18', -50000, 'CZK', 'mortgage', 'confirmed');

			insert into loan (id, name, currency, principal_minor, owed_minor)
				values ('${rowId('register-group-loan')}', 'Karlín', 'CZK', 5000000, 4120000);
			insert into loan_event (id, loan_id, happened_on, kind, amount_minor, interest_minor, transaction_id)
				values (
					'${rowId('register-group-claim')}',
					'${rowId('register-group-loan')}',
					'2026-06-18', 'payment', 50000, 15000,
					'${rowId('jun-instalment')}'
				);
		`);
	});

	it('brings only the interest into the group it is filed under', async () => {
		const housing = await registerPage(filter({ groupKey: 'housing' }), testDb);

		expect(housing.rows.map((row) => row.id)).toContain(rowId('jun-instalment'));
		// The 17 100 the other housing rows come to, plus the 15 000 of interest
		// and not the 50 000 that left the account.
		expect(housing.totals).toEqual([{ currency: 'CZK', sumMinor: -32100n }]);
	});

	it('brings only the principal into the savings group', async () => {
		const savings = await registerPage(filter({ groupKey: 'savings' }), testDb);

		expect(savings.rows.map((row) => row.id)).toEqual([rowId('jun-instalment')]);
		expect(savings.totals).toEqual([{ currency: 'CZK', sumMinor: -35000n }]);
	});

	// The row that opens under those totals has to be able to show the same two
	// figures they were summed from — one in the database, one in Node, and a
	// panel that rounded the other way would contradict its own footer.
	it('offers the row the same two halves the totals were summed from', async () => {
		const claims = await loanPaymentByTransaction([rowId('jun-instalment')], testDb);

		expect(claims.get(rowId('jun-instalment'))).toEqual({
			loanId: rowId('register-group-loan'),
			loanName: 'Karlín',
			halves: {
				interestMinor: -15000n,
				principalMinor: -35000n,
				principalLabel: 'Loan principal'
			}
		});
	});

	// Both halves are still one debit: nothing about the split changes what the
	// account paid out, so the unfiltered footing is what it always was.
	it('leaves the whole debit in the unfiltered total', async () => {
		const all = await registerPage(filter(), testDb);

		expect(all.total).toBe(6);
		expect(all.totals).toEqual([{ currency: 'CZK', sumMinor: -45100n }]);
	});
});
