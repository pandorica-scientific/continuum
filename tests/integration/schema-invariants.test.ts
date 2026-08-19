import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';
import { ENUMS, ENUM_COLUMNS, checkName } from '$lib/enums';

/**
 * Conventions the schema is locked to as of v0.3.9.
 *
 * These are not style checks. Each one encodes a defect class the schema has
 * already been bitten by, and each is cheap enough to run on every push.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('schema-invariants', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

interface ColumnSet {
	table: string;
	columns: string;
}

describe('foreign keys', () => {
	it('every foreign key has a covering index on its own columns', async () => {
		const keys = await harness.sql<ColumnSet[]>`
			select
				c.relname as table,
				string_agg(a.attname, ',' order by k.ord) as columns
			from pg_constraint fk
			join pg_class c on c.oid = fk.conrelid
			cross join lateral unnest(fk.conkey) with ordinality as k(attnum, ord)
			join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.attnum
			where fk.contype = 'f'
			  and c.relnamespace = 'public'::regnamespace
			group by fk.oid, c.relname
		`;

		const indexes = await harness.sql<ColumnSet[]>`
			select
				c.relname as table,
				string_agg(a.attname, ',' order by k.ord) as columns
			from pg_index i
			join pg_class c on c.oid = i.indrelid
			cross join lateral unnest(string_to_array(i.indkey::text, ' ')::int[])
				with ordinality as k(attnum, ord)
			join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
			where c.relnamespace = 'public'::regnamespace
			  -- A PARTIAL index serves only queries carrying its predicate.
			  -- property_bill_meter_property_idx indexes property_id WHERE
			  -- source = 'meter', which does nothing for "the bills of this
			  -- property" — counting it as covering would hide a real scan.
			  and i.indpred is null
			group by i.indexrelid, c.relname
		`;

		// An index covers a foreign key when the key's columns are a PREFIX of the
		// index's columns — a lookup by (a) is served by an index on (a, b), but
		// not by one on (b, a).
		const covered = (fk: ColumnSet) =>
			indexes.some((ix) => ix.table === fk.table && `${ix.columns},`.startsWith(`${fk.columns},`));

		const uncovered = keys.filter((fk) => !covered(fk)).map((fk) => `${fk.table}(${fk.columns})`);
		expect(uncovered.sort()).toEqual([]);
	});
});

describe('enum columns', () => {
	it('every closed set is enforced by a CHECK the database agrees with', async () => {
		const rows = await harness.sql<{ name: string; definition: string }[]>`
			select conname as name, pg_get_constraintdef(oid) as definition
			from pg_constraint
			where contype = 'c' and connamespace = 'public'::regnamespace
		`;
		const byName = new Map(rows.map((r) => [r.name, r.definition]));

		const missing: string[] = [];
		const wrong: string[] = [];
		for (const { table, column, enum: key } of ENUM_COLUMNS) {
			const definition = byName.get(checkName(table, column));
			if (!definition) {
				missing.push(`${table}.${column}`);
				continue;
			}
			// Compare the SET of quoted literals, not the text: PostgreSQL rewrites
			// `in (...)` as `= ANY (ARRAY[...])` and orders them as it pleases.
			const inConstraint = new Set(
				(definition.match(/'[^']*'/g) ?? []).map((quoted) => quoted.slice(1, -1))
			);
			const declared = new Set<string>(ENUMS[key]);
			const absent = [...declared].filter((v) => !inConstraint.has(v));
			const extra = [...inConstraint].filter((v) => !declared.has(v));
			if (absent.length || extra.length) {
				wrong.push(`${table}.${column}: missing ${absent.join('|')} extra ${extra.join('|')}`);
			}
		}
		expect({ missing, wrong }).toEqual({ missing: [], wrong: [] });
	});

	it('rejects a value outside the set', async () => {
		await expect(
			harness.sql`insert into person (id, name, initials, role) values ('e1','X','X','superuser')`
		).rejects.toThrow(/person_role_check/);
	});
});
