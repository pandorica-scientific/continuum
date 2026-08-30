import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { deleteTag, loadTagsFor, setTransactionTags, tagTotals, tagUsage } from '$lib/server/tags';
import { registerMonths, registerPage } from '$lib/server/transactions';
import { DEFAULT_PAGE_SIZE } from '$lib/transactions/filter';
import { UNCATEGORISED, type RegisterFilter } from '$lib/transactions/filter';

let harness: Harness;
let testDb: TestDb;

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
	harness = await startPostgres('transactions-tags');
	testDb = harness.db;
	// The real schema, not a hand-written subset of it. The subset that used to
	// live here had to be kept in step with schema.ts by hand, and a test passing
	// against a stale copy of a table says nothing about the real one.
	await harness.applyMigrations(ALL_MIGRATIONS);

	// A fault injector, not schema: it makes one specific tag name fail on
	// insert, so the rollback test below has something real to roll back from.
	await harness.sql.unsafe(`
		create function reject_explode_tag() returns trigger language plpgsql as $$
		begin
			if exists (select 1 from tag where id = new.tag_id and normalised_name = 'explode') then
				raise exception 'rejected test tag';
			end if;
			return new;
		end $$;
		create trigger reject_explode before insert on tag_link
		for each row execute function reject_explode_tag();
	`);
}, 60_000);

beforeEach(async () => {
	await harness.sql.unsafe(`
		-- entity too: TRUNCATE fires no row triggers, so registrations would
		-- otherwise outlive the rows they belong to and collide on a reused id.
		truncate table tag_link, transaction_split,
			"transaction", currency_rate, tag, category, account, entity restart identity cascade;
		insert into account (id, name, currency, bank) values ('${rowId('a1')}', 'Current', 'CZK', 'fio');
		insert into category (id, group_key, name) values
			('groceries', 'living', 'Groceries'),
			('${rowId('household')}', 'living', 'Household'),
			('salary', 'income', 'Salary');
	`);
});

afterAll(async () => {
	await harness?.stop();
});

describe('register database aggregates', () => {
	it('counts rows and sums effective lines without materialising the whole ledger', async () => {
		await harness.sql.unsafe(`
			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_on, amount_minor, fee_minor, currency, category_id, review_state)
			values
				('${rowId('split')}', '${rowId('split')}', '${rowId('a1')}', '2026-04-02', -4550, 50, 'CZK', null, 'confirmed'),
				('${rowId('salary-txn')}', '${rowId('salary-txn')}', '${rowId('a1')}', '2026-04-03', 10000, 100, 'CZK', 'salary', 'confirmed');
			insert into transaction_split (id, transaction_id, amount_minor, category_id, sort)
			values
				('${rowId('s1')}', '${rowId('split')}', -3000, 'groceries', 0),
				('${rowId('s2')}', '${rowId('split')}', -1550, '${rowId('household')}', 1);
		`);

		const all = await registerPage(filter(), testDb);
		expect(all.total).toBe(2);
		expect(all.totals).toEqual([{ currency: 'CZK', sumMinor: 5300n }]);

		const groceries = await registerPage(filter({ categoryId: 'groceries' }), testDb);
		expect(groceries.total).toBe(1);
		expect(groceries.totals).toEqual([{ currency: 'CZK', sumMinor: -3050n }]);

		const household = await registerPage(filter({ categoryId: rowId('household') }), testDb);
		expect(household.total).toBe(1);
		expect(household.totals).toEqual([{ currency: 'CZK', sumMinor: -1550n }]);
	});

	it('intersects category and tag filters on effective lines without double counting', async () => {
		await harness.sql.unsafe(`
			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_on, amount_minor, fee_minor, currency, category_id, review_state)
			values
				('${rowId('direct')}', '${rowId('direct')}', '${rowId('a1')}', '2026-04-04', -6000, 100, 'CZK', null, 'confirmed'),
				('${rowId('split-only')}', '${rowId('split-only')}', '${rowId('a1')}', '2026-04-03', -5000, 50, 'CZK', null, 'confirmed'),
				('${rowId('cross-line')}', '${rowId('cross-line')}', '${rowId('a1')}', '2026-04-02', -4000, null, 'CZK', null, 'confirmed'),
				('${rowId('plain-uncategorised')}', '${rowId('plain-uncategorised')}', '${rowId('a1')}', '2026-04-01', -700, null, 'CZK', null, 'confirmed');

			insert into transaction_split (id, transaction_id, amount_minor, category_id, sort)
			values
				('${rowId('direct-uncategorised')}', '${rowId('direct')}', -3000, null, 0),
				('${rowId('direct-groceries')}', '${rowId('direct')}', -2000, 'groceries', 1),
				('${rowId('direct-household')}', '${rowId('direct')}', -1000, '${rowId('household')}', 2),
				('${rowId('only-groceries')}', '${rowId('split-only')}', -3000, 'groceries', 0),
				('${rowId('only-household')}', '${rowId('split-only')}', -2000, '${rowId('household')}', 1),
				('${rowId('cross-groceries')}', '${rowId('cross-line')}', -2000, 'groceries', 0),
				('${rowId('cross-household')}', '${rowId('cross-line')}', -2000, '${rowId('household')}', 1);

			insert into tag (id, name, normalised_name) values ('${rowId('reno')}', 'Renovation', 'renovation');
			insert into tag_link (tag_id, target_id) values ('${rowId('reno')}', '${rowId('direct')}');
			insert into tag_link (tag_id, target_id) values
				('${rowId('reno')}', '${rowId('direct-groceries')}'),
				('${rowId('reno')}', '${rowId('only-groceries')}'),
				('${rowId('reno')}', '${rowId('cross-household')}');
		`);

		const uncategorised = await registerPage(filter({ categoryId: UNCATEGORISED }), testDb);
		expect(uncategorised.total).toBe(2);
		expect(uncategorised.totals).toEqual([{ currency: 'CZK', sumMinor: -3800n }]);

		const tagged = await registerPage(filter({ tagId: rowId('reno') }), testDb);
		expect(tagged.total).toBe(3);
		expect(tagged.totals).toEqual([{ currency: 'CZK', sumMinor: -11150n }]);

		const groceriesTagged = await registerPage(
			filter({ categoryId: 'groceries', tagId: rowId('reno') }),
			testDb
		);
		expect(groceriesTagged.rows.map((row) => row.id)).toEqual([
			rowId('direct'),
			rowId('split-only')
		]);
		expect(groceriesTagged.total).toBe(2);
		expect(groceriesTagged.totals).toEqual([{ currency: 'CZK', sumMinor: -5050n }]);
	});

	it('keeps aggregate counts and totals correct beyond one page', async () => {
		await harness.sql.unsafe(`
			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_on, amount_minor, currency, category_id, review_state)
			select
				-- A deterministic uuid per row: the id column is uuid now, so a
				-- 'bulk-07' string will not do.
				('00000000-0000-5000-8000-' || lpad(i::text, 12, '0'))::uuid,
				'bulk-' || lpad(i::text, 2, '0'),
				'${rowId('a1')}',
				date '2026-03-01' + i,
				i * 100,
				'CZK',
				'salary',
				'confirmed'
			from generate_series(1, 55) as series(i);
		`);

		// Pinned to a size rather than the default: the fixture is 55 rows so that
		// the second page is a short one, and that arithmetic is the point of the
		// test. Reading the default here would make it change meaning whenever the
		// register's default does.
		const paged = { categoryId: 'salary', pageSize: 50 };
		const first = await registerPage(filter(paged), testDb);
		expect(first.rows).toHaveLength(50);
		expect(first.total).toBe(55);
		expect(first.pageCount).toBe(2);
		expect(first.totals).toEqual([{ currency: 'CZK', sumMinor: 154000n }]);

		const second = await registerPage(filter({ ...paged, page: 2 }), testDb);
		expect(second.rows).toHaveLength(5);
		expect(second.total).toBe(55);
		expect(second.totals).toEqual(first.totals);
	});

	it('compares base-currency amount bounds using the value-date FX rate', async () => {
		await harness.sql.unsafe(`
			insert into currency_rate (code, day, rate) values
				('EUR', '2026-01-01', 25),
				('EUR', '2026-02-01', 26),
				('USD', '2026-01-01', 20),
				('USD', '2026-02-01', 21);
			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_on, value_on, amount_minor, currency, category_id, review_state)
			values
				('${rowId('old-rate')}', '${rowId('old-rate')}', '${rowId('a1')}', '2026-02-10', '2026-01-10', 10000, 'USD', 'salary', 'confirmed'),
				('${rowId('new-rate')}', '${rowId('new-rate')}', '${rowId('a1')}', '2026-02-10', null, 10000, 'USD', 'salary', 'confirmed');
		`);

		// $100 was EUR 80.00 on the value date and EUR 80.77 on the booking
		// date. Bounds are entered as EUR because that is the household base.
		const page = await registerPage(
			filter({ baseCurrency: 'EUR', minMinor: 8050n, maxMinor: 8100n }),
			testDb
		);
		expect(page.rows.map((row) => row.id)).toEqual([rowId('new-rate')]);
		expect(page.total).toBe(1);
		expect(page.totals).toEqual([{ currency: 'USD', sumMinor: 10000n }]);
	});
});

describe('tag persistence', () => {
	// A tag is a filing decision the person made, not import provenance. When
	// pairing later marks the transaction a transfer, dropping it from the tag
	// left the total at zero while the register still rendered the chip on the
	// row — two screens disagreeing with nothing to explain why.
	it('keeps a tagged leg in project totals after it becomes a transfer', async () => {
		await harness.sql.unsafe(`
			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_on, amount_minor, currency, transfer_pair_id)
			values ('${rowId('paired-leg')}', '${rowId('paired-leg')}', '${rowId('a1')}', '2026-04-02', -100, 'CZK', '${rowId('pair-a')}');
			insert into tag (id, name, normalised_name) values ('${rowId('trip')}', 'Trip', '${rowId('trip')}');
			insert into tag_link (tag_id, target_id) values ('${rowId('trip')}', '${rowId('paired-leg')}');
		`);

		expect(await tagTotals(testDb)).toMatchObject([
			{ id: rowId('trip'), totals: [{ currency: 'CZK', sumMinor: -100n }] }
		]);
	});

	it('loads direct and split tags once and records both scopes', async () => {
		await harness.sql.unsafe(`
			insert into "transaction" (id, dedup_fingerprint, account_id, booked_on, amount_minor, currency)
			values ('${rowId('t1')}', '${rowId('t1')}', '${rowId('a1')}', '2026-04-02', -100, 'CZK');
			insert into transaction_split (id, transaction_id, amount_minor, sort)
			values ('${rowId('s1')}', '${rowId('t1')}', -100, 0);
			insert into tag (id, name, normalised_name) values ('${rowId('reno')}', 'Renovation', 'renovation');
			insert into tag_link (tag_id, target_id) values ('${rowId('reno')}', '${rowId('t1')}');
			insert into tag_link (tag_id, target_id) values ('${rowId('reno')}', '${rowId('s1')}');
		`);

		expect((await loadTagsFor([rowId('t1')], testDb)).get(rowId('t1'))).toEqual([
			{ id: rowId('reno'), name: 'Renovation', direct: true, split: true }
		]);
	});

	it('rolls the delete and newly-created tags back when replacement fails', async () => {
		await harness.sql.unsafe(`
			insert into "transaction" (id, dedup_fingerprint, account_id, booked_on, amount_minor, currency)
			values ('${rowId('t1')}', '${rowId('t1')}', '${rowId('a1')}', '2026-04-02', -100, 'CZK');
			insert into tag (id, name, normalised_name) values ('${rowId('old')}', 'Old', '${rowId('old')}');
			insert into tag_link (tag_id, target_id) values ('${rowId('old')}', '${rowId('t1')}');
		`);

		await expect(setTransactionTags(rowId('t1'), ['Explode'], testDb)).rejects.toThrow();
		const rows = await harness.sql.unsafe<{ name: string }[]>(`
			select tag.name from tag_link join tag on tag.id = tag_link.tag_id
			where tag_link.target_id = '${rowId('t1')}'
		`);
		expect(rows).toEqual([{ name: 'Old' }]);
		expect(await harness.sql.unsafe(`select 1 from tag where normalised_name = 'explode'`)).toEqual(
			[]
		);
	});

	/**
	 * A tag could be created but never removed, so one typed once stayed on the
	 * list forever. Deleting it has to untag everything it was on, and stop any
	 * rule that applied it from applying it.
	 */
	it('untags everything it was on, and drops out of the rules that applied it', async () => {
		await harness.sql.unsafe(`
			insert into "transaction" (id, dedup_fingerprint, account_id, booked_on, amount_minor, currency)
			values ('${rowId('t1')}', '${rowId('t1')}', '${rowId('a1')}', '2026-04-02', -100, 'CZK');
			insert into tag (id, name, normalised_name) values ('${rowId('doomed')}', 'Doomed', 'doomed');
			insert into tag_link (tag_id, target_id) values ('${rowId('doomed')}', '${rowId('t1')}');
			insert into rule (id, name, conditions) values ('${rowId('r1')}', 'Doomed rule', '[]'::jsonb);
			insert into rule_tag (rule_id, tag_id) values ('${rowId('r1')}', '${rowId('doomed')}');
		`);

		expect(await tagUsage(null, testDb)).toEqual(
			new Map([[rowId('doomed'), { tagged: 1, rules: 1 }]])
		);
		expect(await deleteTag(rowId('doomed'), testDb)).toBe(true);

		// Nothing had to be visited to unfile it: both link tables cascade.
		expect((await loadTagsFor([rowId('t1')], testDb)).size).toBe(0);
		expect(await harness.sql.unsafe(`select 1 from tag_link`)).toEqual([]);
		expect(await harness.sql.unsafe(`select 1 from rule_tag`)).toEqual([]);
		// The rule itself is untouched — it just stops contributing that tag.
		expect(await harness.sql.unsafe(`select 1 from rule`)).toHaveLength(1);
	});

	it('says so when the tag is not there', async () => {
		expect(await deleteTag(rowId('nope'), testDb)).toBe(false);
	});
});

/**
 * The register lists a month per row and opens one at a time. Two rules carry
 * that: a month's figures come from the same effective lines the register's own
 * footing does, and the open month narrows the transactions loaded WITHOUT
 * narrowing the list of months — a register showing only the row it had
 * expanded would have nothing left to expand into.
 */
describe('register months', () => {
	beforeEach(async () => {
		await harness.sql.unsafe(`
			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_on, amount_minor, fee_minor, currency, category_id, review_state)
			values
				('${rowId('may-pay')}', '${rowId('may-pay')}', '${rowId('a1')}', '2026-05-29', 10000, null, 'CZK', 'salary', 'confirmed'),
				('${rowId('jun-pay')}', '${rowId('jun-pay')}', '${rowId('a1')}', '2026-06-30', 20000, null, 'CZK', 'salary', 'confirmed'),
				('${rowId('jun-shop')}', '${rowId('jun-shop')}', '${rowId('a1')}', '2026-06-02', -5000, 100, 'CZK', 'groceries', 'confirmed'),
				('${rowId('jun-rent')}', '${rowId('jun-rent')}', '${rowId('a1')}', '2026-06-01', -3000, null, 'CZK', 'groceries', 'confirmed');
		`);
	});

	it('groups by booked month, newest first, with in and out kept apart', async () => {
		const months = await registerMonths(filter(), testDb);

		expect(months.map((m) => m.month)).toEqual(['2026-06', '2026-05']);
		expect(months[0].count).toBe(3);
		// The fee comes off the line it belongs to, exactly as the register's own
		// totals take it — so 5000 + 100 went out, not 5000.
		expect(months[0].byCurrency).toEqual([
			{ currency: 'CZK', inMinor: 20000n, outMinor: 8100n, sumMinor: 11900n }
		]);
		expect(months[1].byCurrency).toEqual([
			{ currency: 'CZK', inMinor: 10000n, outMinor: 0n, sumMinor: 10000n }
		]);
	});

	it('narrows to what the filter selects, on the same effective lines', async () => {
		const months = await registerMonths(filter({ categoryId: 'groceries' }), testDb);

		// May held only pay, so it drops out entirely rather than reporting zero.
		expect(months.map((m) => m.month)).toEqual(['2026-06']);
		expect(months[0].count).toBe(2);
		expect(months[0].byCurrency).toEqual([
			{ currency: 'CZK', inMinor: 0n, outMinor: 8100n, sumMinor: -8100n }
		]);
	});

	it('lists every month whichever one is open', async () => {
		const open = filter({ month: '2026-06' });

		// The month says which row is EXPANDED, so it governs the transactions...
		const page = await registerPage(open, testDb);
		expect(page.total).toBe(3);
		expect(page.rows.every((r) => r.bookedAt.startsWith('2026-06'))).toBe(true);

		// ...and nothing about the list of months.
		expect((await registerMonths(open, testDb)).map((m) => m.month)).toEqual([
			'2026-06',
			'2026-05'
		]);
	});
});
