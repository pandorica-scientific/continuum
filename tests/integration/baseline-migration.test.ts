import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTITY_KINDS, ENUM_COLUMNS } from '$lib/enums';
import { SHELF_SEED_ROWS } from '$lib/server/db/schema/documents';
import { assertSchemaIsCurrent } from '$lib/server/db/migrate';
import { rowId } from '../row-id';
import { ALL_MIGRATIONS, migrationFiles, startPostgres, type Harness } from './harness';

/**
 * The baseline builds the whole schema, including everything drizzle-kit cannot.
 *
 * Most of it comes back out of `db:generate`; the rest — triggers, generated
 * columns, composite foreign keys, CHECK constraints, an expression index and
 * a view — is carried by hand, and `db:generate` would not notice it missing.
 *
 * So this suite asserts the hand-carried half specifically. A regenerated
 * baseline that dropped the appendix would still create every table and pass
 * a schema-shaped smoke test; it would fail here.
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
		// Continuum has no users, so there is nothing to migrate FROM: `drizzle/`
		// describes the schema as it is now, in one file, not a chain of steps.
		// Fold future changes into the baseline and migrate any live instance by
		// hand — revisit this once somebody other than us is running it.
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
		// A baseline regenerated from a stale schema would bring these back.
		expect(names).not.toContain('import_job');
		expect(names).not.toContain('document_person');
		expect(names).not.toContain('contact_tenancy');
	});

	it('creates the equity tables and prices', async () => {
		const tables = await harness.sql<{ tablename: string }[]>`
			select tablename from pg_tables where schemaname = 'public' order by tablename`;
		const names = tables.map((t) => t.tablename);
		expect(names).toContain('security_price');
		expect(names).toContain('equity_grant');
		expect(names).toContain('equity_tranche');
	});

	it('counts a vested, held tranche in net worth at the latest price', async () => {
		const personId = rowId('person-equity');
		const grantId = rowId('grant-equity');
		await harness.sql`insert into person (id, name, initials, role) values (${personId}, 'Eq', 'E', 'member')`;
		await harness.sql`insert into equity_grant (id, person_id, ticker, currency, granted_on, total_units)
			values (${grantId}, ${personId}, 'ACME.US', 'USD', '2025-03-01', 400)`;
		await harness.sql`insert into equity_tranche (id, grant_id, vests_on, units, settled_on, delivered_units, withheld_units)
			values (${rowId('tranche-1')}, ${grantId}, '2026-03-01', 100, '2026-03-01', 62, 38)`;
		await harness.sql`insert into equity_tranche (id, grant_id, vests_on, units)
			values (${rowId('tranche-2')}, ${grantId}, '2099-03-01', 100)`;
		await harness.sql`insert into security_price (ticker, day, close_minor, currency, source)
			values ('ACME.US', '2026-09-10', 14000, 'USD', 'yahoo'), ('ACME.US', '2026-09-12', 14230, 'USD', 'yahoo')`;
		const rows = await harness.sql<{ kind: string; value_minor: string; valued_on: string }[]>`
			select kind, value_minor::text, valued_on::text from net_worth_component where kind = 'equity'`;
		expect(rows).toHaveLength(1);
		expect(rows[0].value_minor).toBe(String(62 * 14230));
		expect(rows[0].valued_on).toBe('2026-09-12');
	});

	it('registers a record in the supertype without the caller doing anything', async () => {
		// The BEFORE INSERT trigger, generated entity_kind column and composite
		// foreign key together: an unregistered row cannot exist, and none can
		// register under the wrong kind.
		await harness.sql`insert into person (id, name, initials)
			values (${'11111111-1111-4111-8111-111111111111'}, 'Ada', 'A')`;
		const rows = await harness.sql<{ kind: string }[]>`
			select kind from entity where id = ${'11111111-1111-4111-8111-111111111111'}`;
		expect(rows.map((r) => r.kind)).toEqual(['person']);

		// The AFTER DELETE trigger retires it again, so no orphan remains for a
		// later link to attach to.
		await harness.sql`delete from person where id = ${'11111111-1111-4111-8111-111111111111'}`;
		expect(
			await harness.sql`select 1 from entity where id = ${'11111111-1111-4111-8111-111111111111'}`
		).toHaveLength(0);
	});

	it('seeds the rows the schema cannot imply, and no subject', async () => {
		// Data, not schema — `db:generate` never re-emits these, and a
		// regenerated baseline would drop them silently, with no schema
		// comparison to catch it.
		//
		// No subject is seeded: one belongs to a shelf, and paper naming no card
		// sits on the dossier's "Not assigned yet" card instead, which is drawn
		// rather than stored.
		const subjects = await harness.sql<{ name: string }[]>`select name from subject`;
		expect(subjects).toHaveLength(0);

		// A floor, not the list: the harness runs refreshCurrencies afterwards,
		// as boot() does, and CLDR fills in the rest.
		const codes = await harness.sql<{ code: string }[]>`
			select code from currency where code in ('CZK', 'EUR') order by code`;
		expect(codes.map((row) => row.code)).toEqual(['CZK', 'EUR']);
	});

	it('carries the triggers, CHECKs and expression index drizzle cannot generate', async () => {
		// Derived from the kind list, not a literal: a kind added to ENTITY_KINDS
		// without its trigger is exactly the drift this exists to catch.
		const [{ n: entityTriggers }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_trigger where tgname like '%_retire_entity_trg'`;
		expect(entityTriggers).toBe(ENTITY_KINDS.length);

		const [{ n: legTrigger }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_trigger where tgname = 'transfer_pair_leg_claims'`;
		expect(legTrigger).toBe(1);

		// A partial unique index: one meter bill per property, other bills
		// unconstrained. A plain unique index would refuse a second manual bill.
		const [{ indexdef }] = await harness.sql<{ indexdef: string }[]>`
			select indexdef from pg_indexes where indexname = 'property_bill_meter_property_idx'`;
		expect(indexdef).toMatch(/where.*source.*meter/i);

		// The effective date is an expression, not a column, so a plain booked_on
		// index cannot serve it and db:generate cannot emit this one. Asserted by
		// definition so a baseline that swapped in a booked_on-only index (of the
		// same name) is still caught.
		const [{ indexdef: effective }] = await harness.sql<{ indexdef: string }[]>`
			select indexdef from pg_indexes where indexname = 'transaction_effective_on_idx'`;
		expect(effective).toMatch(/coalesce.*value_on.*booked_on/i);

		// Built on contact_fold(), only creatable behind the unaccent extension.
		const [{ n: search }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_indexes where indexname = 'contact_search_idx'`;
		expect(search).toBe(1);

		// One per enum column, plus entity.kind; db:generate emits none of them.
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
		// A query that folds differently than these indexes gets a silent
		// sequential scan instead of an error, so this is an assertion, not
		// something a benchmark would catch.
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
		// Ordered by how often a shelf is opened, not by how the keys were
		// invented: paper reached for weekly sits above paper produced twice a
		// decade.
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
		// Seven of the eight are system shelves: four are written to by key
		// (capture, import, payslips/tax, bills), three hold paper every
		// household has (identity, health, inventory). Vehicles stays removable,
		// which is why this is a list rather than "every seeded shelf".
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
		// ON DELETE RESTRICT is what makes reassign-then-delete the only legal
		// path always, not just in the UI.
		const [{ id: shelfId }] = await harness.sql<{ id: string }[]>`
			select id from shelf where key = 'inventory'`;
		await harness.sql`
			insert into document (id, name, shelf_id, ext, added_on, type)
			values (gen_random_uuid(), 'Deed', ${shelfId}, 'PDF', current_date, 'other')`;
		await expect(harness.sql`delete from shelf where id = ${shelfId}`).rejects.toThrow();
	});

	it('creates none of the retired duplicate columns', async () => {
		// A payslip's figure and currency live on `salary_entry`, and a tax
		// statement reaches its papers through `document_link`. A baseline that
		// still creates these columns invites a second source of truth back in.
		const rows = await harness.sql<{ detail: string }[]>`
			select table_name || '.' || column_name as detail
			from information_schema.columns
			where table_schema = 'public'
			  and ((table_name = 'document' and column_name in ('amount_minor', 'currency'))
			    or (table_name = 'tax_statement' and column_name = 'document_id'))`;
		expect(rows.map((r) => r.detail)).toEqual([]);

		// A dropped column takes its index and foreign key with it automatically;
		// asserted anyway so this is caught by name, not just by luck.
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

		// `period_on` is kept: it is the month a payslip covers, and
		// `payslipMatchingContent` matches a re-uploaded slip on it.
		const kept = await harness.sql<{ column_name: string }[]>`
			select column_name from information_schema.columns
			where table_schema = 'public' and table_name = 'document'
			  and column_name = 'period_on'`;
		expect(kept.map((r) => r.column_name)).toEqual(['period_on']);
	});

	it('lets an import file name the document it was filed as, and holds on to it', async () => {
		// RESTRICT, not SET NULL or CASCADE: the statement document is the
		// evidence for the import, so deleting it must be refused rather than
		// quietly leaving an import that can no longer show what it read.
		const [{ definition }] = await harness.sql<{ definition: string }[]>`
			select pg_get_constraintdef(oid) as definition from pg_constraint
			where conname = 'import_file_document_id_document_id_fk'`;
		expect(definition).toMatch(/REFERENCES "?document"?\(id\) ON DELETE RESTRICT/i);

		// The covering index every foreign key needs.
		const [{ n }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from pg_indexes
			where indexname = 'import_file_document_idx'`;
		expect(n).toBe(1);
	});

	it('accepts a broker report as a kind of paper', async () => {
		// The CHECK is hand-written in the appendix, so nothing but this notices
		// the value going missing.
		await harness.sql`
			insert into document (id, name, shelf_id, ext, added_on, type)
			values (gen_random_uuid(), 'Broker report 2025',
				(select id from shelf where key = 'statements'), 'PDF', current_date, 'broker_report')`;
		const [{ n }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from document where type = 'broker_report'`;
		expect(n).toBe(1);
	});

	it('carries the identity detail table, its cascade and both its CHECKs', async () => {
		// Hand-written in the appendix: nothing but this notices if the table
		// arrives without the constraints that keep country in a shape the flag
		// and card artwork can read.
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

		// Cascade, not restrict: these fields are a property of the paper itself.
		await harness.sql`delete from document where id = ${documentId}`;
		const [{ n }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from document_identity where document_id = ${documentId}`;
		expect(n).toBe(0);
	});

	it('seeds every shelf with the type list its profile names', async () => {
		// The registry the app reads and the seed the baseline writes must agree
		// on a fresh install, or a shelf opens offering something nobody chose.
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
		// A shelf is one question, one unit, one template, all three on the row
		// rather than in a registry keyed by shelf.
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
		// Vehicles proves `every`: a technical inspection is one cell two years
		// wide, not two cells one of which is always empty.
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
		// An organisation seeds from its kind, not from the shelf.
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
 * Regression: rewriting `drizzle/0000_baseline.sql` in place while
 * `meta/_journal.json` kept its old `when` made drizzle's migrator apply
 * nothing to a database that already recorded the old baseline as run — an
 * upgraded instance booted against a stale schema and 500s later, silently.
 *
 * The guard's expectations are derived from the Drizzle schema (every table
 * and column it declares) rather than one hand-picked column a developer
 * would have to re-point every release.
 */
describe('the boot guard', () => {
	it('is silent on a database built from this baseline', async () => {
		await expect(assertSchemaIsCurrent(harness.db)).resolves.toBeUndefined();
	});

	it('refuses to serve one an older release left behind', async () => {
		// Both tables are dropped by name: `cascade` on the parent would also
		// drop the child's foreign key and leave the child standing.
		await harness.sql`drop table document_identity_number`;
		await harness.sql`drop table document_identity`;
		try {
			await expect(assertSchemaIsCurrent(harness.db)).rejects.toThrow(/empty one/i);
			// And it names which object is missing.
			await expect(assertSchemaIsCurrent(harness.db)).rejects.toThrow(/document_identity/);
		} finally {
			// Put the harness back as the rest of this file expects to find it.
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
