import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXCEPT_FINGERPRINT_REPAIR, startPostgres, type Harness, type TestDb } from './harness';
import { loadTagsFor, setTransactionTags, tagTotals } from '$lib/server/tags';
import { PAGE_SIZE, registerPage } from '$lib/server/transactions';
import { UNCATEGORISED, type RegisterFilter } from '$lib/transactions/filter';

let harness: Harness;
let testDb: TestDb;

const filter = (overrides: Partial<RegisterFilter> = {}): RegisterFilter => ({
	search: null,
	from: null,
	to: null,
	accountId: null,
	categoryId: null,
	direction: 'any',
	minMinor: null,
	maxMinor: null,
	baseCurrency: 'CZK',
	reviewState: null,
	tagId: null,
	includeTransfers: false,
	sourceMethod: null,
	page: 1,
	...overrides
});

beforeAll(async () => {
	harness = await startPostgres('transactions-tags');
	testDb = harness.db;
	// The real schema, not a hand-written subset of it. The subset that used to
	// live here had to be kept in step with schema.ts by hand, and a test passing
	// against a stale copy of a table says nothing about the real one.
	await harness.applyMigrations(EXCEPT_FINGERPRINT_REPAIR);

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
		insert into account (id, name, currency, bank) values ('a1', 'Current', 'CZK', 'fio');
		insert into category (id, group_key, name) values
			('groceries', 'living', 'Groceries'),
			('household', 'living', 'Household'),
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
				(id, dedup_fingerprint, account_id, booked_at, amount, fee_minor, currency, category_id, review_state)
			values
				('split', 'split', 'a1', '2026-04-02', -4550, 50, 'CZK', null, 'confirmed'),
				('salary', 'salary', 'a1', '2026-04-03', 10000, 100, 'CZK', 'salary', 'confirmed');
			insert into transaction_split (id, transaction_id, amount_minor, category_id, sort)
			values
				('s1', 'split', -3000, 'groceries', 0),
				('s2', 'split', -1550, 'household', 1);
		`);

		const all = await registerPage(filter(), testDb);
		expect(all.total).toBe(2);
		expect(all.totals).toEqual([{ currency: 'CZK', sumMinor: 5300n }]);

		const groceries = await registerPage(filter({ categoryId: 'groceries' }), testDb);
		expect(groceries.total).toBe(1);
		expect(groceries.totals).toEqual([{ currency: 'CZK', sumMinor: -3050n }]);

		const household = await registerPage(filter({ categoryId: 'household' }), testDb);
		expect(household.total).toBe(1);
		expect(household.totals).toEqual([{ currency: 'CZK', sumMinor: -1550n }]);
	});

	it('intersects category and tag filters on effective lines without double counting', async () => {
		await harness.sql.unsafe(`
			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_at, amount, fee_minor, currency, category_id, review_state)
			values
				('direct', 'direct', 'a1', '2026-04-04', -6000, 100, 'CZK', null, 'confirmed'),
				('split-only', 'split-only', 'a1', '2026-04-03', -5000, 50, 'CZK', null, 'confirmed'),
				('cross-line', 'cross-line', 'a1', '2026-04-02', -4000, null, 'CZK', null, 'confirmed'),
				('plain-uncategorised', 'plain-uncategorised', 'a1', '2026-04-01', -700, null, 'CZK', null, 'confirmed');

			insert into transaction_split (id, transaction_id, amount_minor, category_id, sort)
			values
				('direct-uncategorised', 'direct', -3000, null, 0),
				('direct-groceries', 'direct', -2000, 'groceries', 1),
				('direct-household', 'direct', -1000, 'household', 2),
				('only-groceries', 'split-only', -3000, 'groceries', 0),
				('only-household', 'split-only', -2000, 'household', 1),
				('cross-groceries', 'cross-line', -2000, 'groceries', 0),
				('cross-household', 'cross-line', -2000, 'household', 1);

			insert into tag (id, name, normalised_name) values ('reno', 'Renovation', 'renovation');
			insert into tag_link (tag_id, target_id) values ('reno', 'direct');
			insert into tag_link (tag_id, target_id) values
				('reno', 'direct-groceries'),
				('reno', 'only-groceries'),
				('reno', 'cross-household');
		`);

		const uncategorised = await registerPage(filter({ categoryId: UNCATEGORISED }), testDb);
		expect(uncategorised.total).toBe(2);
		expect(uncategorised.totals).toEqual([{ currency: 'CZK', sumMinor: -3800n }]);

		const tagged = await registerPage(filter({ tagId: 'reno' }), testDb);
		expect(tagged.total).toBe(3);
		expect(tagged.totals).toEqual([{ currency: 'CZK', sumMinor: -11150n }]);

		const groceriesTagged = await registerPage(
			filter({ categoryId: 'groceries', tagId: 'reno' }),
			testDb
		);
		expect(groceriesTagged.rows.map((row) => row.id)).toEqual(['direct', 'split-only']);
		expect(groceriesTagged.total).toBe(2);
		expect(groceriesTagged.totals).toEqual([{ currency: 'CZK', sumMinor: -5050n }]);
	});

	it('keeps aggregate counts and totals correct beyond one page', async () => {
		await harness.sql.unsafe(`
			insert into "transaction"
				(id, dedup_fingerprint, account_id, booked_at, amount, currency, category_id, review_state)
			select
				'bulk-' || lpad(i::text, 2, '0'),
				'bulk-' || lpad(i::text, 2, '0'),
				'a1',
				date '2026-03-01' + i,
				i * 100,
				'CZK',
				'salary',
				'confirmed'
			from generate_series(1, 55) as series(i);
		`);

		const first = await registerPage(filter({ categoryId: 'salary' }), testDb);
		expect(first.rows).toHaveLength(PAGE_SIZE);
		expect(first.total).toBe(55);
		expect(first.pageCount).toBe(2);
		expect(first.totals).toEqual([{ currency: 'CZK', sumMinor: 154000n }]);

		const second = await registerPage(filter({ categoryId: 'salary', page: 2 }), testDb);
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
				(id, dedup_fingerprint, account_id, booked_at, value_date, amount, currency, category_id, review_state)
			values
				('old-rate', 'old-rate', 'a1', '2026-02-10', '2026-01-10', 10000, 'USD', 'salary', 'confirmed'),
				('new-rate', 'new-rate', 'a1', '2026-02-10', null, 10000, 'USD', 'salary', 'confirmed');
		`);

		// $100 was EUR 80.00 on the value date and EUR 80.77 on the booking
		// date. Bounds are entered as EUR because that is the household base.
		const page = await registerPage(
			filter({ baseCurrency: 'EUR', minMinor: 8050n, maxMinor: 8100n }),
			testDb
		);
		expect(page.rows.map((row) => row.id)).toEqual(['new-rate']);
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
				(id, dedup_fingerprint, account_id, booked_at, amount, currency, transfer_pair_id)
			values ('paired-leg', 'paired-leg', 'a1', '2026-04-02', -100, 'CZK', 'pair-a');
			insert into tag (id, name, normalised_name) values ('trip', 'Trip', 'trip');
			insert into tag_link (tag_id, target_id) values ('trip', 'paired-leg');
		`);

		expect(await tagTotals(testDb)).toMatchObject([
			{ id: 'trip', totals: [{ currency: 'CZK', sumMinor: -100n }] }
		]);
	});

	it('loads direct and split tags once and records both scopes', async () => {
		await harness.sql.unsafe(`
			insert into "transaction" (id, dedup_fingerprint, account_id, booked_at, amount, currency)
			values ('t1', 't1', 'a1', '2026-04-02', -100, 'CZK');
			insert into transaction_split (id, transaction_id, amount_minor, sort)
			values ('s1', 't1', -100, 0);
			insert into tag (id, name, normalised_name) values ('reno', 'Renovation', 'renovation');
			insert into tag_link (tag_id, target_id) values ('reno', 't1');
			insert into tag_link (tag_id, target_id) values ('reno', 's1');
		`);

		expect((await loadTagsFor(['t1'], testDb)).get('t1')).toEqual([
			{ id: 'reno', name: 'Renovation', direct: true, split: true }
		]);
	});

	it('rolls the delete and newly-created tags back when replacement fails', async () => {
		await harness.sql.unsafe(`
			insert into "transaction" (id, dedup_fingerprint, account_id, booked_at, amount, currency)
			values ('t1', 't1', 'a1', '2026-04-02', -100, 'CZK');
			insert into tag (id, name, normalised_name) values ('old', 'Old', 'old');
			insert into tag_link (tag_id, target_id) values ('old', 't1');
		`);

		await expect(setTransactionTags('t1', ['Explode'], testDb)).rejects.toThrow();
		const rows = await harness.sql.unsafe<{ name: string }[]>(`
			select tag.name from tag_link join tag on tag.id = tag_link.tag_id
			where tag_link.target_id = 't1'
		`);
		expect(rows).toEqual([{ name: 'Old' }]);
		expect(await harness.sql.unsafe(`select 1 from tag where normalised_name = 'explode'`)).toEqual(
			[]
		);
	});
});
