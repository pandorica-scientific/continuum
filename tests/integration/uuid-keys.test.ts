import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

/**
 * Surrogate keys are `uuid`, and the ids we mint are time-ordered.
 *
 * The type is the smaller half of this: 16 bytes against 37, an integer-pair
 * comparison rather than a varlena one, and a column that cannot hold a string
 * which is not a uuid. The larger half is the generator — v4 is random across
 * its whole range, so every insert lands somewhere else in the B-tree and the
 * index fragments as history grows, while v7 leads with a millisecond timestamp
 * and appends.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('uuid-keys', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

/**
 * Ids that are NOT ours to choose, or that are deliberately readable.
 *
 * Each is a decision. `category` is the interesting one: its ids are slugs —
 * 'salary', 'groceries' — referenced by name in the seed and in code, which
 * makes them a natural key rather than a surrogate.
 */
const STAYS_TEXT = new Set([
	'category',
	'session',
	'api_token',
	'enrollment_token',
	'webauthn_challenge',
	'credential',
	'broker_operation',
	'broker_position',
	'broker_import_state',
	'settings',
	'setup_claim',
	'currency',
	'import_profile',
	'job'
]);

describe('column types', () => {
	it('every surrogate id is a uuid, and every deliberate exception is not', async () => {
		const rows = await harness.sql<{ table_name: string; data_type: string }[]>`
			select table_name, data_type from information_schema.columns
			where table_schema = 'public' and column_name = 'id'
			order by table_name`;

		const wrong = rows
			.filter((r) =>
				STAYS_TEXT.has(r.table_name) ? r.data_type !== 'text' : r.data_type !== 'uuid'
			)
			.map((r) => `${r.table_name}.id is ${r.data_type}`);
		expect(wrong).toEqual([]);
	});

	it('every column referencing a uuid id is a uuid too', async () => {
		// PostgreSQL would refuse to create such a key across mismatched types, so
		// this asserts the migration put every one of them back.
		const mismatched = await harness.sql<{ detail: string }[]>`
			select format('%s.%s -> %s.%s', c.relname, a.attname, p.relname, pa.attname) as detail
			from pg_constraint fk
			join pg_class c on c.oid = fk.conrelid
			join pg_class p on p.oid = fk.confrelid
			cross join lateral unnest(fk.conkey) with ordinality as k(attnum, ord)
			join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.attnum
			join lateral unnest(fk.confkey) with ordinality as f(attnum, ord2) on f.ord2 = k.ord
			join pg_attribute pa on pa.attrelid = fk.confrelid and pa.attnum = f.attnum
			where fk.contype = 'f' and c.relnamespace = 'public'::regnamespace
			  and a.atttypid <> pa.atttypid`;
		expect(mismatched.map((r) => r.detail)).toEqual([]);
	});

	it('keeps the soft pointers in step, which no key would have caught', async () => {
		const rows = await harness.sql<{ table_name: string; data_type: string }[]>`
			select table_name, data_type from information_schema.columns
			where (table_name = 'transaction' and column_name = 'transfer_pair_id')
			   or (table_name = 'job' and column_name = 'subject_id')`;
		// transfer_pair_id is deliberately not a foreign key, to avoid a cycle.
		// job.subject_id names an account or a calendar account. Nothing in the
		// catalogue relates either one to what it points at.
		expect(rows.map((r) => r.data_type)).toEqual(['uuid', 'uuid']);
	});

	it('leaves entity_kind alone, because a kind is not an id', async () => {
		const [{ data_type }] = await harness.sql<{ data_type: string }[]>`
			select data_type from information_schema.columns
			where table_name = 'transaction' and column_name = 'entity_kind'`;
		expect(data_type).toBe('text');
	});
});

describe('what the constraints still do', () => {
	it('refuses a value that is not a uuid at all', async () => {
		await expect(
			harness.sql`insert into person (id, name, initials) values ('person-a', 'Jana', 'J')`
		).rejects.toThrow(/invalid input syntax for type uuid/i);
	});

	it('still registers an entity and still cascades', async () => {
		const id = uuidv7();
		await harness.sql`insert into tag (id, name, normalised_name)
			values (${id}, 'Renovation', 'renovation-uuid')`;
		const [e] = await harness.sql<{ kind: string }[]>`
			select kind from entity where id = ${id}`;
		expect(e.kind).toBe('tag');

		await harness.sql`delete from tag where id = ${id}`;
		expect(await harness.sql`select 1 from entity where id = ${id}`).toHaveLength(0);
	});

	it('still refuses a link to something that is not a record', async () => {
		const tag = uuidv7();
		await harness.sql`insert into tag (id, name, normalised_name)
			values (${tag}, 'Holiday', 'holiday-uuid')`;
		await expect(
			harness.sql`insert into tag_link (tag_id, target_id) values (${tag}, ${uuidv7()})`
		).rejects.toThrow(/foreign key|violates/i);
	});
});

describe('the generator', () => {
	it('mints ids that sort in the order they were made', () => {
		// The whole point of v7 over v4: new rows append to the right of the index
		// instead of scattering across it.
		const made = Array.from({ length: 500 }, () => uuidv7());
		expect(made).toEqual([...made].sort());
	});
});
