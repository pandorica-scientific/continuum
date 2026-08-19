import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

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
