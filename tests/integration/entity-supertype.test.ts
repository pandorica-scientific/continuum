import { rowId } from '../row-id';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTITY_KINDS } from '$lib/enums';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

/**
 * The supertype every linkable record registers in.
 *
 * It exists so one link table can point at any kind of record and still keep a
 * real foreign key at both ends — thirteen pair-specific link tables collapse to
 * three, and a new module inherits tagging, document filing and contact linking
 * without a table of its own.
 *
 * Registration is a BEFORE INSERT trigger rather than something callers
 * remember. That is the whole reason this is safe to add to twelve tables at
 * once: nothing above the database changes, and an insert that forgot to
 * register cannot exist.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('entity-supertype', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

const tag = async (id: string, name: string) =>
	harness.sql`insert into tag (id, name, normalised_name) values (${id}, ${name}, ${name})`;

describe('registration', () => {
	it('gives a new row an entity of its own kind, with no help from the caller', async () => {
		await tag(rowId('t-1'), 'renovation');
		const rows = await harness.sql<{ kind: string }[]>`
			select kind from entity where id = ${rowId('t-1')}`;
		expect(rows).toEqual([{ kind: 'tag' }]);
	});

	it('registers rows in every kind that has a link table', async () => {
		// Each of these is inserted with only its own columns; the entity row is
		// the database's doing.
		await harness.sql`insert into person (id, name, initials) values (${rowId('p-1')}, 'Jana', 'J')`;
		await harness.sql`insert into account (id, name, bank, currency)
			values (${rowId('a-1')}, 'Current', 'other', 'CZK')`;
		await harness.sql`insert into property (id, name, kind) values (${rowId('pr-1')}, 'Flat', 'lived')`;
		await harness.sql`insert into document (id, name, shelf_id, type, added_on)
			values (${rowId('d-1')}, 'Lease', (select id from shelf where key = 'tenancy'), 'contract', '2026-01-01')`;
		await harness.sql`insert into contact (id, name) values (${rowId('c-1')}, 'Plumber')`;
		await harness.sql`insert into subject (id, name) values (${rowId('s-1')}, 'The car')`;

		const rows = await harness.sql<{ kind: string }[]>`
			select kind from entity where id in (${rowId('p-1')}, ${rowId('a-1')}, ${rowId('pr-1')},
				${rowId('d-1')}, ${rowId('c-1')}, ${rowId('s-1')})
			order by kind`;
		// Ordered by kind, not by id: ids are uuids now and sort by nothing a reader
		// would recognise.
		expect(rows.map((r) => r.kind)).toEqual([
			'account',
			'contact',
			'document',
			'person',
			'property',
			'subject'
		]);
	});

	it('carries the row’s own creation time where the table records one', async () => {
		await harness.sql`insert into person (id, name, initials, created_at)
			values (${rowId('p-2')}, 'Petr', 'P', '2019-03-04T10:00:00Z')`;
		const [{ iso }] = await harness.sql<{ iso: string }[]>`
			select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') as iso
			from entity where id = ${rowId('p-2')}`;
		// Not "now". The demo seed dates rows years back, and an entity younger
		// than its own record is exactly the divergence a shared audit column is
		// supposed to remove.
		expect(iso).toBe('2019-03-04T10:00:00');
	});
});

describe('kind cannot be wrong', () => {
	it('refuses a row whose entity is registered as something else', async () => {
		await harness.sql`insert into entity (id, kind) values (${rowId('x-1')}, 'person')`;
		// A tag claiming an id registered as a person is unrepresentable, not merely
		// discouraged: without this, a link table would accept the id and the bad
		// row would read as valid.
		await expect(tag(rowId('x-1'), 'holiday')).rejects.toThrow(/foreign key|violates/i);
	});

	it('refuses an entity of a kind that is not a kind', async () => {
		await expect(
			harness.sql`insert into entity (id, kind) values (${rowId('x-2')}, 'spaceship')`
		).rejects.toThrow(/entity_kind_check/);
	});
});

describe('lifecycle, in both directions', () => {
	it('deleting the entity removes the record', async () => {
		await tag(rowId('t-2'), 'car');
		await harness.sql`delete from entity where id = ${rowId('t-2')}`;
		expect(await harness.sql`select 1 from tag where id = ${rowId('t-2')}`).toHaveLength(0);
	});

	it('deleting the record retires the entity', async () => {
		await tag(rowId('t-3'), 'holiday-2');
		await harness.sql`delete from tag where id = ${rowId('t-3')}`;
		// Without this the supertype accumulates orphans, and a later link could
		// still attach itself to one.
		expect(await harness.sql`select 1 from entity where id = ${rowId('t-3')}`).toHaveLength(0);
	});

	it('leaves no orphan entity behind after a cascade', async () => {
		// Deleting a property cascades to its tenancies, each of which must retire
		// its own entity on the way out.
		await harness.sql`insert into property (id, name, kind) values (${rowId('pr-2')}, 'Flat 2', 'rented')`;
		await harness.sql`insert into tenancy (id, property_id, tenant_name)
			values (${rowId('tn-1')}, ${rowId('pr-2')}, 'Someone')`;
		await harness.sql`delete from property where id = ${rowId('pr-2')}`;
		const rows =
			await harness.sql`select 1 from entity where id in (${rowId('pr-2')}, ${rowId('tn-1')})`;
		expect(rows).toHaveLength(0);
	});
});

describe('coverage', () => {
	it('every declared kind has a table that registers it', async () => {
		const rows = await harness.sql<{ table_name: string }[]>`
			select c.relname as table_name
			from pg_trigger t
			join pg_class c on c.oid = t.tgrelid
			where t.tgname like '%_register_entity_trg'
			  and c.relnamespace = 'public'::regnamespace`;
		expect(rows.map((r) => r.table_name).sort()).toEqual([...ENTITY_KINDS].sort());
	});

	it('every registering table also retires', async () => {
		const rows = await harness.sql<{ table_name: string }[]>`
			select c.relname as table_name
			from pg_trigger t
			join pg_class c on c.oid = t.tgrelid
			where t.tgname like '%_retire_entity_trg'
			  and c.relnamespace = 'public'::regnamespace`;
		expect(rows.map((r) => r.table_name).sort()).toEqual([...ENTITY_KINDS].sort());
	});

	it('has an entity for every pre-existing row, not just new ones', async () => {
		// The migration backfills. A table left unbackfilled would look fine until
		// someone tried to tag an older record.
		for (const kind of ENTITY_KINDS) {
			const [{ n }] = await harness.sql<{ n: number }[]>`
				select count(*)::int as n
				from ${harness.sql(kind)} t
				left join entity e on e.id = t.id
				where e.id is null`;
			expect(n, `${kind} rows with no entity`).toBe(0);
		}
	});
});
