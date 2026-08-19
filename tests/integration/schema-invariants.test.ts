import { rowId } from '../row-id';
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

		const indexes = await harness.sql<(ColumnSet & { unique: boolean })[]>`
			select
				c.relname as table,
				string_agg(a.attname, ',' order by k.ord) as columns,
				i.indisunique as unique
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
			group by i.indexrelid, c.relname, i.indisunique
		`;

		// An index covers a foreign key when the key's columns are a PREFIX of the
		// index's columns — a lookup by (a) is served by an index on (a, b), but
		// not by one on (b, a).
		//
		// The converse also counts, when the shorter index is UNIQUE. Each of the
		// eleven `(id, entity_kind)` keys added by migration 0049 leads with the
		// table's own primary key, so the primary-key index already narrows the
		// lookup to at most one row and `entity_kind` is a stored constant. An
		// index on the pair would be dead weight, and demanding one here would have
		// bought eleven of them.
		const covered = (fk: ColumnSet) =>
			indexes.some(
				(ix) =>
					ix.table === fk.table &&
					(`${ix.columns},`.startsWith(`${fk.columns},`) ||
						(ix.unique && `${fk.columns},`.startsWith(`${ix.columns},`)))
			);

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
			harness.sql`insert into person (id, name, initials, role) values (${rowId('e1')},'X','X','superuser')`
		).rejects.toThrow(/person_role_check/);
	});
});

/**
 * `day` on the snapshot and rate tables is a time DIMENSION KEY — what the row
 * is about — rather than an attribute of it, so it keeps its bare name. Listed
 * here rather than tolerated silently.
 */
const DATE_NAME_EXCEPTIONS = new Set(['day']);

describe('naming conventions', () => {
	it('every money column is bigint and ends _minor', async () => {
		const rows = await harness.sql<
			{ table_name: string; column_name: string; data_type: string }[]
		>`
			select table_name, column_name, data_type from information_schema.columns
			where table_schema = 'public' and column_name like '%\\_minor'`;
		expect(rows.filter((r) => r.data_type !== 'bigint')).toEqual([]);
		expect(rows.length).toBeGreaterThan(20);
	});

	it('no money column hides under another name', async () => {
		// A bigint that is not a count and not a minor-unit amount is a money column
		// that got away — `transaction.amount` was exactly that for a long time.
		const rows = await harness.sql<{ detail: string }[]>`
			select format('%s.%s', table_name, column_name) as detail
			from information_schema.columns
			where table_schema = 'public' and data_type = 'bigint'
			  and column_name not like '%\\_minor'
			  and column_name not in ('counter')`;
		expect(rows.map((r) => r.detail)).toEqual([]);
	});

	it('a date ends _on and an instant ends _at', async () => {
		const rows = await harness.sql<
			{ table_name: string; column_name: string; data_type: string }[]
		>`
			select table_name, column_name, data_type from information_schema.columns
			where table_schema = 'public'
			  and data_type in ('date', 'timestamp with time zone')`;
		const wrong = rows
			.filter((r) => !DATE_NAME_EXCEPTIONS.has(r.column_name))
			.filter((r) =>
				r.data_type === 'date' ? !r.column_name.endsWith('_on') : !r.column_name.endsWith('_at')
			)
			.map((r) => `${r.table_name}.${r.column_name} (${r.data_type})`);
		expect(wrong.sort()).toEqual([]);
	});
});
