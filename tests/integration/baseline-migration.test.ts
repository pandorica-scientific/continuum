import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENUM_COLUMNS } from '$lib/enums';
import { ALL_MIGRATIONS, migrationFiles, startPostgres, type Harness } from './harness';

/**
 * The baseline builds the whole schema, including everything drizzle-kit cannot.
 *
 * Fifty-six migrations collapsed into one file. Most of what they built comes
 * back out of `db:generate`; the rest — triggers, generated columns, composite
 * foreign keys, CHECK constraints, an expression index and a view — has to be
 * carried by hand, and nothing about `db:generate` would notice it missing.
 *
 * So this suite asserts the hand-carried half specifically. A regenerated
 * baseline that dropped the appendix would still create every table and still
 * pass a schema-shaped smoke test; it would fail here.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('baseline-migration', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

describe('the baseline migration', () => {
	it('is the only migration', () => {
		// Continuum has no users, so there is nothing to migrate FROM. `drizzle/`
		// describes the schema as it is now, in one file, rather than describing
		// how it got here — a chain of steps nobody will ever walk.
		//
		// Adding a second file is not forbidden by accident: fold the change into
		// the baseline instead, and migrate any live instance by hand. The moment
		// somebody other than us is running this, that stops being true and this
		// test is the place the decision gets revisited.
		expect(migrationFiles()).toEqual(['0000_baseline.sql']);
	});

	it('creates the tables the app reads, and none the squash retired', async () => {
		const tables = await harness.sql<{ tablename: string }[]>`
			select tablename from pg_tables where schemaname = 'public' order by tablename`;
		const names = tables.map((t) => t.tablename);
		expect(names).toContain('entity');
		expect(names).toContain('tag_link');
		expect(names).toContain('currency');
		expect(names).toContain('job');
		// The queue and the per-pair link tables the chain replaced. A baseline
		// regenerated from a stale schema would bring them back.
		expect(names).not.toContain('import_job');
		expect(names).not.toContain('document_person');
		expect(names).not.toContain('contact_tenancy');
	});

	it('registers a record in the supertype without the caller doing anything', async () => {
		// The BEFORE INSERT trigger, the generated entity_kind column and the
		// composite foreign key, all at once: an unregistered row cannot exist,
		// and it cannot be registered under the wrong kind.
		await harness.sql`insert into person (id, name, initials)
			values (${'11111111-1111-4111-8111-111111111111'}, 'Ada', 'A')`;
		const rows = await harness.sql<{ kind: string }[]>`
			select kind from entity where id = ${'11111111-1111-4111-8111-111111111111'}`;
		expect(rows.map((r) => r.kind)).toEqual(['person']);

		// And the AFTER DELETE trigger retires it again, so the supertype cannot
		// fill with orphans a later link could still attach to.
		await harness.sql`delete from person where id = ${'11111111-1111-4111-8111-111111111111'}`;
		expect(
			await harness.sql`select 1 from entity where id = ${'11111111-1111-4111-8111-111111111111'}`
		).toHaveLength(0);
	});

	it('seeds the two rows the schema cannot imply', async () => {
		// Data, not schema — so `db:generate` will never re-emit these, and a
		// regenerated baseline drops them silently. The first symptom of the
		// household subject going missing was a tick absent from the documents
		// form, which no schema comparison would have caught.
		const subjects = await harness.sql<{ name: string }[]>`select name from subject`;
		expect(subjects.map((row) => row.name)).toEqual(['Household']);

		// A floor, not the list: the harness runs refreshCurrencies afterwards, as
		// boot() does, and CLDR fills in the rest.
		const codes = await harness.sql<{ code: string }[]>`
			select code from currency where code in ('CZK', 'EUR') order by code`;
		expect(codes.map((row) => row.code)).toEqual(['CZK', 'EUR']);
	});

	it('carries the triggers, CHECKs and expression index drizzle cannot generate', async () => {
		const [{ n: entityTriggers }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_trigger where tgname like '%_retire_entity_trg'`;
		expect(entityTriggers).toBe(11);

		const [{ n: legTrigger }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_trigger where tgname = 'transfer_pair_leg_claims'`;
		expect(legTrigger).toBe(1);

		// The partial unique index: one meter bill per property, other bills
		// unconstrained. A plain unique index here would refuse the second manual
		// bill on a flat.
		const [{ indexdef }] = await harness.sql<{ indexdef: string }[]>`
			select indexdef from pg_indexes where indexname = 'property_bill_meter_property_idx'`;
		expect(indexdef).toMatch(/where.*source.*meter/i);

		// Built on contact_fold(), which is itself only creatable in the right
		// order behind the unaccent extension.
		const [{ n: search }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_indexes where indexname = 'contact_search_idx'`;
		expect(search).toBe(1);

		// One per enum column, plus entity.kind. The exact list is held to
		// src/lib/enums.ts by schema-invariants.test.ts; what matters here is that
		// the baseline carries them at all, since db:generate emits none of them.
		const [{ n: checks }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_constraint
			where contype = 'c' and conname like '%\\_check'`;
		expect(checks).toBeGreaterThanOrEqual(ENUM_COLUMNS.length + 1);

		const [{ n: view }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_views
			where schemaname = 'public' and viewname = 'net_worth_component'`;
		expect(view).toBe(1);
	});
});
