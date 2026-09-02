import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTITY_KINDS, ENUM_COLUMNS } from '$lib/enums';
import { SHELF_SEED_ROWS } from '$lib/server/db/schema/documents';
import { assertSchemaIsCurrent } from '$lib/server/db/migrate';
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

	it('seeds the rows the schema cannot imply, and no subject', async () => {
		// Data, not schema — so `db:generate` will never re-emit these, and a
		// regenerated baseline drops them silently. The first symptom of a seeded
		// row going missing is a screen with a control absent, which no schema
		// comparison would have caught.
		//
		// NO subject. v0.7.x seeded a catch-all "Household" one so a document
		// always had something to be about; a subject now belongs to a shelf, and
		// paper that names no card sits on the dossier's "Not assigned yet" card
		// instead — which is drawn rather than stored.
		const subjects = await harness.sql<{ name: string }[]>`select name from subject`;
		expect(subjects).toHaveLength(0);

		// A floor, not the list: the harness runs refreshCurrencies afterwards, as
		// boot() does, and CLDR fills in the rest.
		const codes = await harness.sql<{ code: string }[]>`
			select code from currency where code in ('CZK', 'EUR') order by code`;
		expect(codes.map((row) => row.code)).toEqual(['CZK', 'EUR']);
	});

	it('carries the triggers, CHECKs and expression index drizzle cannot generate', async () => {
		// Derived from the kind list, not a literal: a kind added to ENTITY_KINDS
		// without its trigger is exactly the drift this assertion exists to catch,
		// and a hard-coded count turns that into a chore of bumping a number.
		const [{ n: entityTriggers }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_trigger where tgname like '%_retire_entity_trg'`;
		expect(entityTriggers).toBe(ENTITY_KINDS.length);

		const [{ n: legTrigger }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_trigger where tgname = 'transfer_pair_leg_claims'`;
		expect(legTrigger).toBe(1);

		// The partial unique index: one meter bill per property, other bills
		// unconstrained. A plain unique index here would refuse the second manual
		// bill on a flat.
		const [{ indexdef }] = await harness.sql<{ indexdef: string }[]>`
			select indexdef from pg_indexes where indexname = 'property_bill_meter_property_idx'`;
		expect(indexdef).toMatch(/where.*source.*meter/i);

		// The date every window is measured on is an expression, not a column, so
		// the plain booked_on index cannot serve a bound on it and db:generate
		// cannot emit this one. Asserted by definition rather than by name: a
		// regenerated baseline that replaced it with an index on booked_on alone
		// would still be an index of that name.
		const [{ indexdef: effective }] = await harness.sql<{ indexdef: string }[]>`
			select indexdef from pg_indexes where indexname = 'transaction_effective_on_idx'`;
		expect(effective).toMatch(/coalesce.*value_on.*booked_on/i);

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
	it('carries pg_trgm and the three expression indexes the search needs', async () => {
		// Expression indexes over contact_fold(), matching the query's own fold
		// exactly. A query that folds differently gets a sequential scan and
		// nothing says so — which is what makes this an assertion rather than a
		// benchmark.
		const [{ n: ext }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_extension where extname = 'pg_trgm'`;
		expect(ext).toBe(1);

		const indexes = await harness.sql<{ indexname: string }[]>`
			select indexname from pg_indexes where schemaname = 'public'`;
		const names = indexes.map((i) => i.indexname);
		expect(names).toContain('dtc_fts_idx');
		expect(names).toContain('dtc_trgm_idx');
		expect(names).toContain('document_name_trgm_idx');
	});

	it('seeds eight shelves, seven of them system', async () => {
		const rows = await harness.sql<{ key: string; system: boolean }[]>`
			select key, system from shelf order by sort_order`;
		// Ordered by how often a shelf is opened rather than by how the keys were
		// invented: the paper a household reaches for weekly sits above the paper
		// it produces twice a decade.
		//
		// Eight rather than ten since v0.8.0. Family folded into IDs — a birth
		// certificate is proof of who somebody is, and it was already a card in the
		// same wallet — and Tenancy folded into Property, because a lease is an
		// obligation on an address and belongs on that address's card.
		expect(rows.map((r) => r.key)).toEqual([
			'inbox',
			'identity',
			'statements',
			'income_tax',
			'health',
			'inventory',
			'property',
			'vehicles'
		]);
		// Seven of the eight, for two reasons the flag deliberately does not
		// distinguish. Four are written to by key — capture files into inbox,
		// import into statements, payslips and tax attachments into income_tax,
		// bills into property. Three are the paper every household has, fixed so
		// that a passport, a test result or a boiler warranty is in the same place
		// on every instance: identity, health, inventory.
		//
		// vehicles is the one that stays removable, and the reason this assertion
		// is a list rather than "every seeded shelf".
		expect(rows.filter((r) => r.system).map((r) => r.key)).toEqual([
			'inbox',
			'identity',
			'statements',
			'income_tax',
			'health',
			'inventory',
			'property'
		]);
	});

	it('refuses to delete a shelf that still holds paper', async () => {
		// ON DELETE RESTRICT. The only legal delete is reassign-then-delete, and
		// this is the constraint that makes "always" true rather than "in the UI".
		const [{ id: shelfId }] = await harness.sql<{ id: string }[]>`
			select id from shelf where key = 'inventory'`;
		await harness.sql`
			insert into document (id, name, shelf_id, ext, added_on, type)
			values (gen_random_uuid(), 'Deed', ${shelfId}, 'PDF', current_date, 'other')`;
		await expect(harness.sql`delete from shelf where id = ${shelfId}`).rejects.toThrow();
	});

	it('creates none of the columns v0.7.1 stopped writing', async () => {
		// A payslip's figure and its currency live on `salary_entry`, and a tax
		// statement reaches its papers through `document_link`. Each of these was
		// still being written while nothing read it, which is how a second source
		// of truth for one fact gets back in. A baseline that still creates them
		// hands the next feature that choice again.
		const rows = await harness.sql<{ detail: string }[]>`
			select table_name || '.' || column_name as detail
			from information_schema.columns
			where table_schema = 'public'
			  and ((table_name = 'document' and column_name in ('amount_minor', 'currency'))
			    or (table_name = 'tax_statement' and column_name = 'document_id'))`;
		expect(rows.map((r) => r.detail)).toEqual([]);

		// The index and foreign key that went with `document.currency` and
		// `tax_statement.document_id`. A dropped column takes these with it
		// automatically — asserted anyway, so a baseline regenerated from a
		// schema file that forgot to drop the column back is caught by name
		// rather than by the column check alone happening to still catch it.
		const [{ n: staleIndexes }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_indexes
			where indexname in ('document_currency_idx', 'tax_statement_document_idx')`;
		expect(staleIndexes).toBe(0);

		const [{ n: staleFks }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_constraint
			where conname in (
				'document_currency_currency_code_fk',
				'tax_statement_document_id_document_id_fk'
			)`;
		expect(staleFks).toBe(0);

		// `period_on` is NOT one of them: it is the month a payslip covers, and
		// `payslipMatchingContent` matches a re-uploaded slip on it.
		const kept = await harness.sql<{ column_name: string }[]>`
			select column_name from information_schema.columns
			where table_schema = 'public' and table_name = 'document'
			  and column_name = 'period_on'`;
		expect(kept.map((r) => r.column_name)).toEqual(['period_on']);
	});

	it('lets an import file name the document it was filed as, and holds on to it', async () => {
		// RESTRICT rather than SET NULL or CASCADE: the statement document IS the
		// evidence for the import, so deleting it has to be refused rather than
		// quietly leaving an import that can no longer show what it read.
		const [{ definition }] = await harness.sql<{ definition: string }[]>`
			select pg_get_constraintdef(oid) as definition from pg_constraint
			where conname = 'import_file_document_id_document_id_fk'`;
		expect(definition).toMatch(/REFERENCES "?document"?\(id\) ON DELETE RESTRICT/i);

		// The covering index schema-invariants demands of every foreign key.
		const [{ n }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_indexes
			where indexname = 'import_file_document_idx'`;
		expect(n).toBe(1);
	});

	it('accepts a broker report as a kind of paper', async () => {
		// A broker's yearly report is the paper behind the investments tab, and
		// filing it as 'other' is what made it unfindable. The CHECK is written by
		// hand in the appendix, so nothing but this notices a new value missing.
		await harness.sql`
			insert into document (id, name, shelf_id, ext, added_on, type)
			values (gen_random_uuid(), 'Broker report 2025',
				(select id from shelf where key = 'statements'), 'PDF', current_date, 'broker_report')`;
		const [{ n }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from document where type = 'broker_report'`;
		expect(n).toBe(1);
	});

	it('carries the identity detail table, its cascade and both its CHECKs', async () => {
		// Hand-written in the appendix, like every CHECK: nothing but this notices
		// if the table arrives without the constraints that keep the country in a
		// shape the flag and the card artwork can read.
		const [{ id: documentId }] = await harness.sql<{ id: string }[]>`
			insert into document (id, name, shelf_id, ext, added_on, type)
			values (gen_random_uuid(), 'Passport',
				(select id from shelf where key = 'identity'), 'PDF', current_date, 'id_document')
			returning id`;
		await harness.sql`
			insert into document_identity (document_id, kind, country, number, issued_on)
			values (${documentId}, 'passport', 'CZ', '12345678', '2022-05-02')`;

		await expect(
			harness.sql`update document_identity set kind = 'visa' where document_id = ${documentId}`
		).rejects.toThrow(/document_identity_kind_check/);
		await expect(
			harness.sql`update document_identity set country = 'cz' where document_id = ${documentId}`
		).rejects.toThrow(/document_identity_country_check/);
		await expect(
			harness.sql`update document_identity set country = 'Czechia' where document_id = ${documentId}`
		).rejects.toThrow(/document_identity_country_check/);

		// A country of nothing is a document whose face does not say one.
		await harness.sql`update document_identity set country = null where document_id = ${documentId}`;

		// Cascade, not restrict: these fields are a property of the paper, and
		// paper that is gone has no face to read them off.
		await harness.sql`delete from document where id = ${documentId}`;
		const [{ n }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from document_identity where document_id = ${documentId}`;
		expect(n).toBe(0);
	});

	it('seeds every shelf with the type list its profile names', async () => {
		// Two places hold the same fact — the registry the app reads and the seed
		// the baseline writes — and the household edits the second afterwards. On
		// a fresh install they have to agree, or a shelf opens offering something
		// nobody chose.
		const rows = await harness.sql<{ key: string; type: string; ordinal: number }[]>`
			select s.key, t.type, t.ordinal from shelf_type t
			join shelf s on s.id = t.shelf_id
			order by s.key, t.ordinal`;
		const seeded = new Map<string, string[]>();
		for (const row of rows) seeded.set(row.key, [...(seeded.get(row.key) ?? []), row.type]);

		for (const row of SHELF_SEED_ROWS) {
			expect(seeded.get(row.key) ?? [], row.key).toEqual([...row.types]);
		}
	});

	it('seeds the eight shelves with their template, unit and question', async () => {
		// A shelf is one question, one unit, one template — and all three are on
		// the row rather than in a registry keyed by shelf, so a shelf somebody
		// makes gets the same three.
		const rows = await harness.sql<
			{ key: string; template: string; unit: string; question: string; system: boolean }[]
		>`select key, template, unit, question, system from shelf order by sort_order`;
		expect(rows).toEqual(
			SHELF_SEED_ROWS.map((s) => ({
				key: s.key,
				template: s.template,
				unit: s.unit,
				question: s.question,
				system: s.system
			}))
		);
	});

	it('seeds the lanes a new card on each shelf starts with', async () => {
		const rows = await harness.sql<{ key: string; lane_seeds: unknown }[]>`
			select key, lane_seeds from shelf order by sort_order`;
		const byKey = new Map(rows.map((r) => [r.key, r.lane_seeds]));
		// Vehicles is the shelf that proves `every`: a technical inspection is one
		// cell two years wide, not two cells one of which is always empty.
		expect(byKey.get('vehicles')).toEqual([
			{ label: 'Insurance', cadence: 'yearly', every: 1 },
			{ label: 'Technical inspection', cadence: 'yearly', every: 2 },
			{ label: 'Road tax', cadence: 'yearly', every: 1 }
		]);
		expect(byKey.get('inventory')).toEqual([
			{ label: 'Receipt', cadence: 'once', every: 1 },
			{ label: 'Warranty', cadence: 'once', every: 1 },
			{ label: 'Manual', cadence: 'once', every: 1 }
		]);
		// An organisation seeds from its KIND, not from the shelf.
		expect(byKey.get('income_tax')).toEqual([]);
	});

	it('refuses a subject whose active period runs backwards', async () => {
		await expect(
			harness.sql`
			insert into subject (id, name, shelf_id, active_from, active_to)
			values (gen_random_uuid(), 'Backwards',
			        (select id from shelf where key = 'inventory'), '2026-06-01', '2026-01-01')`
		).rejects.toThrow();
	});
});

/**
 * The boot guard, on a database this release actually built.
 *
 * `drizzle/0000_baseline.sql` was rewritten in place while `meta/_journal.json`
 * kept its old `when`, so drizzle's migrator applies NOTHING to a database that
 * already recorded the old baseline as run. An instance upgraded by pulling the
 * image therefore boots against a 0.6.2/0.7.0 schema and 500s at the first
 * statement import, hours later, with nothing at boot having said so.
 *
 * What the guard demands is DERIVED from the Drizzle schema — every table and
 * column it declares — rather than being one hand-picked column a developer had
 * to re-point every release. That is what makes this suite worth running: the
 * old form was tautological here, because the database was built from the same
 * baseline that defined the column being looked for. Asking
 * `information_schema` for the whole column list costs one round trip and
 * touches no data.
 */
describe('the boot guard', () => {
	it('is silent on a database built from this baseline', async () => {
		await expect(assertSchemaIsCurrent(harness.db)).resolves.toBeUndefined();
	});

	it('refuses to serve one the release notes were never run against', async () => {
		// Exactly what an in-place upgrade leaves behind: the schema this release
		// needs, minus the tables the migrator never created. Both by name —
		// `cascade` on the parent drops the child's foreign key and leaves the
		// child standing, which would leave one of the two in place.
		await harness.sql`drop table document_identity_number`;
		await harness.sql`drop table document_identity`;
		try {
			await expect(assertSchemaIsCurrent(harness.db)).rejects.toThrow(/release notes/i);
			// And it says WHICH object is missing, so the operator is not left
			// diffing two schemas to find out what the release notes are for.
			await expect(assertSchemaIsCurrent(harness.db)).rejects.toThrow(/document_identity/);
		} finally {
			// The release notes' own SQL, which is what an operator would run.
			await harness.sql`
				create table if not exists document_identity (
					document_id uuid primary key references document(id) on delete cascade,
					kind text not null default 'other',
					country text,
					number text,
					issued_on date,
					issuer text,
					constraint document_identity_kind_check
						check (kind in ('passport', 'id_card', 'driving_licence', 'residence_permit', 'other')),
					constraint document_identity_country_check
						check (country is null or country ~ '^[A-Z]{2}$')
				)`;
			await harness.sql`
				create table if not exists document_identity_number (
					document_id uuid not null references document_identity(document_id) on delete cascade,
					ordinal integer not null,
					label text not null,
					value text not null,
					primary key (document_id, ordinal)
				)`;
		}
	});
});
