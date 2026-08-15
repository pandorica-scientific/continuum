import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { removeStalePostgresDirectory } from './embedded-postgres';
import { loadTagsFor, setTransactionTags, tagTotals } from '$lib/server/tags';
import { PAGE_SIZE, registerPage } from '$lib/server/transactions';
import { UNCATEGORISED, type RegisterFilter } from '$lib/transactions/filter';

const PORT = 55443;
const DATABASE = 'continuum_transactions_tags';
const DATABASE_DIR = resolve('scratch-workspace/transactions-tags-postgres');
const URL = `postgres://postgres:password@127.0.0.1:${PORT}/${DATABASE}`;

let embedded: EmbeddedPostgres;
let sqlClient: postgres.Sql;
let testDb: ReturnType<typeof drizzle<typeof schema>>;

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
	page: 1,
	...overrides
});

beforeAll(async () => {
	removeStalePostgresDirectory(DATABASE_DIR);
	embedded = new EmbeddedPostgres({
		databaseDir: DATABASE_DIR,
		port: PORT,
		user: 'postgres',
		password: 'password',
		persistent: false,
		onLog: () => undefined,
		onError: () => undefined
	});
	await embedded.initialise();
	await embedded.start();
	await embedded.createDatabase(DATABASE);
	sqlClient = postgres(URL, { max: 4 });
	testDb = drizzle(sqlClient, { schema });
	await sqlClient.unsafe(`
		create table account (
			id text primary key,
			name text not null,
			currency text not null
		);
		create table category (id text primary key, name text not null);
		create table currency_rate (
			code text not null,
			day date not null,
			rate numeric(14, 6) not null,
			primary key (code, day)
		);
		create table "transaction" (
			id text primary key,
			account_id text not null references account(id),
			booked_at date not null,
			value_date date,
			amount bigint not null,
			fee_minor bigint,
			currency text not null,
			counterparty text,
			description text,
			category_id text references category(id),
			review_state text not null default 'needs_review',
			transfer_pair_id text
		);
		create table transaction_split (
			id text primary key,
			transaction_id text not null references "transaction"(id) on delete cascade,
			amount_minor bigint not null,
			category_id text references category(id),
			note text,
			sort integer not null default 0
		);
		create table tag (
			id text primary key,
			name text not null,
			normalised_name text not null unique,
			created_at timestamptz not null default now()
		);
		create table transaction_tag (
			transaction_id text not null references "transaction"(id) on delete cascade,
			tag_id text not null references tag(id) on delete cascade,
			primary key (transaction_id, tag_id)
		);
		create table transaction_split_tag (
			split_id text not null references transaction_split(id) on delete cascade,
			tag_id text not null references tag(id) on delete cascade,
			primary key (split_id, tag_id)
		);
		create table loan_tag (loan_id text not null, tag_id text not null references tag(id), primary key (loan_id, tag_id));
		create table property_tag (property_id text not null, tag_id text not null references tag(id), primary key (property_id, tag_id));
		create function reject_explode_tag() returns trigger language plpgsql as $$
		begin
			if exists (select 1 from tag where id = new.tag_id and normalised_name = 'explode') then
				raise exception 'rejected test tag';
			end if;
			return new;
		end $$;
		create trigger reject_explode before insert on transaction_tag
		for each row execute function reject_explode_tag();
	`);
}, 30_000);

beforeEach(async () => {
	await sqlClient.unsafe(`
		truncate table transaction_split_tag, transaction_tag, transaction_split,
			"transaction", currency_rate, tag, category, account restart identity cascade;
		insert into account (id, name, currency) values ('a1', 'Current', 'CZK');
		insert into category (id, name) values
			('groceries', 'Groceries'), ('household', 'Household'), ('salary', 'Salary');
	`);
});

afterAll(async () => {
	await sqlClient?.end();
	await embedded?.stop();
}, 30_000);

describe('register database aggregates', () => {
	it('counts rows and sums effective lines without materialising the whole ledger', async () => {
		await sqlClient.unsafe(`
			insert into "transaction"
				(id, account_id, booked_at, amount, fee_minor, currency, category_id, review_state)
			values
				('split', 'a1', '2026-04-02', -4550, 50, 'CZK', null, 'confirmed'),
				('salary', 'a1', '2026-04-03', 10000, 100, 'CZK', 'salary', 'confirmed');
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
		await sqlClient.unsafe(`
			insert into "transaction"
				(id, account_id, booked_at, amount, fee_minor, currency, category_id, review_state)
			values
				('direct', 'a1', '2026-04-04', -6000, 100, 'CZK', null, 'confirmed'),
				('split-only', 'a1', '2026-04-03', -5000, 50, 'CZK', null, 'confirmed'),
				('cross-line', 'a1', '2026-04-02', -4000, null, 'CZK', null, 'confirmed'),
				('plain-uncategorised', 'a1', '2026-04-01', -700, null, 'CZK', null, 'confirmed');

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
			insert into transaction_tag values ('direct', 'reno');
			insert into transaction_split_tag values
				('direct-groceries', 'reno'),
				('only-groceries', 'reno'),
				('cross-household', 'reno');
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
		await sqlClient.unsafe(`
			insert into "transaction"
				(id, account_id, booked_at, amount, currency, category_id, review_state)
			select
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
		await sqlClient.unsafe(`
			insert into currency_rate (code, day, rate) values
				('EUR', '2026-01-01', 25),
				('EUR', '2026-02-01', 26),
				('USD', '2026-01-01', 20),
				('USD', '2026-02-01', 21);
			insert into "transaction"
				(id, account_id, booked_at, value_date, amount, currency, category_id, review_state)
			values
				('old-rate', 'a1', '2026-02-10', '2026-01-10', 10000, 'USD', 'salary', 'confirmed'),
				('new-rate', 'a1', '2026-02-10', null, 10000, 'USD', 'salary', 'confirmed');
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
		await sqlClient.unsafe(`
			insert into "transaction"
				(id, account_id, booked_at, amount, currency, transfer_pair_id)
			values ('paired-leg', 'a1', '2026-04-02', -100, 'CZK', 'pair-a');
			insert into tag (id, name, normalised_name) values ('trip', 'Trip', 'trip');
			insert into transaction_tag values ('paired-leg', 'trip');
		`);

		expect(await tagTotals(testDb)).toMatchObject([
			{ id: 'trip', totals: [{ currency: 'CZK', sumMinor: -100n }] }
		]);
	});

	it('loads direct and split tags once and records both scopes', async () => {
		await sqlClient.unsafe(`
			insert into "transaction" (id, account_id, booked_at, amount, currency)
			values ('t1', 'a1', '2026-04-02', -100, 'CZK');
			insert into transaction_split (id, transaction_id, amount_minor, sort)
			values ('s1', 't1', -100, 0);
			insert into tag (id, name, normalised_name) values ('reno', 'Renovation', 'renovation');
			insert into transaction_tag values ('t1', 'reno');
			insert into transaction_split_tag values ('s1', 'reno');
		`);

		expect((await loadTagsFor(['t1'], testDb)).get('t1')).toEqual([
			{ id: 'reno', name: 'Renovation', direct: true, split: true }
		]);
	});

	it('rolls the delete and newly-created tags back when replacement fails', async () => {
		await sqlClient.unsafe(`
			insert into "transaction" (id, account_id, booked_at, amount, currency)
			values ('t1', 'a1', '2026-04-02', -100, 'CZK');
			insert into tag (id, name, normalised_name) values ('old', 'Old', 'old');
			insert into transaction_tag values ('t1', 'old');
		`);

		await expect(setTransactionTags('t1', ['Explode'], testDb)).rejects.toThrow();
		const rows = await sqlClient.unsafe<{ name: string }[]>(`
			select tag.name from transaction_tag join tag on tag.id = transaction_tag.tag_id
			where transaction_id = 't1'
		`);
		expect(rows).toEqual([{ name: 'Old' }]);
		expect(await sqlClient.unsafe(`select 1 from tag where normalised_name = 'explode'`)).toEqual(
			[]
		);
	});
});
