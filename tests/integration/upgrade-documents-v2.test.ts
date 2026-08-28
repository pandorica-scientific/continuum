// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { upgradeDocumentsV2 } from '../../scripts/upgrade-documents-v2.mjs';
import { startPostgres, statements, type Harness } from './harness';

/**
 * The hand migration a live 0.6.2 instance runs before the 0.7.0 image serves.
 *
 * Continuum keeps ONE baseline and migrates running instances by hand, so this
 * script is the migration — and the thing that must be true of it is that a
 * second run changes nothing. An operator whose first run scrolled off the
 * screen, or a deploy that retried, must not double-file anything or fall over
 * on a constraint that already exists.
 *
 * Each case builds the real 0.6.2 schema from the frozen fixture, so the
 * statements under test meet the shape they will actually meet.
 */
const OLD_BASELINE = readFileSync(resolve('tests/fixtures/baseline-0.6.2.sql'), 'utf8');

/** One document per old shelf key, in the order the CHECK listed them. */
const OLD_SHELVES = [
	'payslips',
	'tax',
	'identity',
	'family',
	'health',
	'property',
	'tenancy',
	'loans',
	'insurance',
	'statements'
] as const;

let harness: Harness;
const created: { sql: postgres.Sql; drop(): Promise<void> }[] = [];

beforeAll(async () => {
	harness = await startPostgres('upgrade-documents-v2', { max: 1 });
}, 180_000);

afterAll(async () => {
	for (const world of created) await world.drop();
	await harness?.stop();
});

let counter = 0;

/** A private database holding the 0.6.2 schema and nothing newer. */
async function seedZeroSixTwo(): Promise<postgres.Sql> {
	const world = await harness.createDatabase(`old-${counter++}`);
	created.push(world);
	for (const statement of statements(OLD_BASELINE)) await world.sql.unsafe(statement);
	return world.sql;
}

async function seedOldDocument(
	sql: postgres.Sql,
	options: { shelf: string; links?: string[]; withFile?: boolean }
): Promise<string> {
	const [{ id }] = await sql<{ id: string }[]>`
		insert into document (id, name, shelf, ext, added_on, expiry_verb, stored_name)
		values (gen_random_uuid(), ${`A ${options.shelf} document`}, ${options.shelf}, 'PDF', '2026-01-01', 'expires',
		        ${options.withFile ? `${randomUUID()}.pdf` : null})
		returning id`;
	for (const targetId of options.links ?? []) {
		await sql`insert into document_link (document_id, target_id) values (${id}, ${targetId})`;
	}
	return id;
}

describe('the 0.6.2 upgrade script', () => {
	it('maps every old shelf and leaves nothing unfiled', async () => {
		const sql = await seedZeroSixTwo();
		for (const shelf of OLD_SHELVES) await seedOldDocument(sql, { shelf });
		await upgradeDocumentsV2(sql);

		const rows = await sql<{ key: string; type: string }[]>`
			select s.key, d.type from document d join shelf s on s.id = d.shelf_id`;
		expect(rows).toHaveLength(10);
		expect(rows.every((r) => r.key && r.type)).toBe(true);

		const [{ n }] = await sql<{ n: number }[]>`
			select count(*)::int as n from information_schema.columns
			where table_name = 'document' and column_name = 'shelf'`;
		expect(n).toBe(0);
	});

	it('maps each old shelf to the pair the handoff specifies', async () => {
		const sql = await seedZeroSixTwo();
		const ids = new Map<string, string>();
		for (const shelf of OLD_SHELVES) ids.set(shelf, await seedOldDocument(sql, { shelf }));
		await upgradeDocumentsV2(sql);

		const rows = await sql<{ id: string; key: string; type: string }[]>`
			select d.id, s.key, d.type from document d join shelf s on s.id = d.shelf_id`;
		const byId = new Map(rows.map((r) => [r.id, r]));
		const expected: Record<string, [string, string]> = {
			payslips: ['finance', 'payslip'],
			tax: ['finance', 'tax_document'],
			identity: ['identity', 'id_document'],
			family: ['family', 'other'],
			health: ['health', 'medical_record'],
			property: ['property', 'other'],
			tenancy: ['tenancy', 'contract'],
			loans: ['finance', 'contract'],
			// Linked to nothing, so it cannot be placed and goes to review.
			insurance: ['inbox', 'insurance_policy'],
			statements: ['statements', 'bank_statement']
		};
		for (const [shelf, [key, type]] of Object.entries(expected)) {
			const row = byId.get(ids.get(shelf)!)!;
			expect([shelf, row.key, row.type]).toEqual([shelf, key, type]);
		}
	});

	it('places an insurance document by what it is linked to', async () => {
		const sql = await seedZeroSixTwo();
		const [{ id: propertyId }] = await sql<{ id: string }[]>`
			insert into property (id, name, kind) values (gen_random_uuid(), 'Flat', 'lived') returning id`;
		const [{ id: personId }] = await sql<{ id: string }[]>`
			insert into person (id, name, initials) values (gen_random_uuid(), 'Jana', 'J') returning id`;
		const onFlat = await seedOldDocument(sql, { shelf: 'insurance', links: [propertyId] });
		const onPerson = await seedOldDocument(sql, { shelf: 'insurance', links: [personId] });
		await upgradeDocumentsV2(sql);

		const rows = await sql<{ id: string; key: string }[]>`
			select d.id, s.key from document d join shelf s on s.id = d.shelf_id`;
		const byId = new Map(rows.map((r) => [r.id, r.key]));
		expect(byId.get(onFlat)).toBe('property');
		expect(byId.get(onPerson)).toBe('health');
	});

	it('sends an insurance document nobody can place to the inbox, tagged', async () => {
		const sql = await seedZeroSixTwo();
		const id = await seedOldDocument(sql, { shelf: 'insurance', links: [] });
		await upgradeDocumentsV2(sql);

		const [row] = await sql<{ key: string }[]>`
			select s.key from document d join shelf s on s.id = d.shelf_id where d.id = ${id}`;
		expect(row.key).toBe('inbox');
		const tags = await sql<{ name: string }[]>`
			select t.name from tag_link tl join tag t on t.id = tl.tag_id where tl.target_id = ${id}`;
		expect(tags.map((t) => t.name)).toContain('insurance');
	});

	it('is a no-op the second time', async () => {
		// The gate. An upgrade someone runs twice — because the first run's
		// output scrolled past, because a deploy retried — must not double-file
		// anything or fail on a constraint that already exists.
		const sql = await seedZeroSixTwo();
		for (const shelf of OLD_SHELVES) await seedOldDocument(sql, { shelf });
		await upgradeDocumentsV2(sql);
		const before = await sql`select id, shelf_id, type from document order by id`;
		await upgradeDocumentsV2(sql);
		const after = await sql`select id, shelf_id, type from document order by id`;
		expect(after).toEqual(before);

		// The one insurance document linked to nothing gets exactly one tag, both
		// times: a second run must not tag it twice or tag anything else.
		const tags = await sql<{ n: number }[]>`select count(*)::int as n from tag_link`;
		expect(tags[0].n).toBe(1);
	});

	it('queues every filed document for reading', async () => {
		// An upgraded instance would otherwise have a working content search and
		// nothing in it to find: every document filed before 0.7.0 has a file and
		// no text.
		const sql = await seedZeroSixTwo();
		for (const shelf of OLD_SHELVES) await seedOldDocument(sql, { shelf, withFile: true });
		await seedOldDocument(sql, { shelf: 'family' });
		await upgradeDocumentsV2(sql);

		const jobs = await sql<{ n: number }[]>`
			select count(*)::int as n from job where kind = 'extract_text' and state = 'queued'`;
		expect(jobs[0].n).toBe(OLD_SHELVES.length);

		// And a second run does not queue any of them twice.
		await upgradeDocumentsV2(sql);
		const again = await sql<{ n: number }[]>`
			select count(*)::int as n from job where kind = 'extract_text'`;
		expect(again[0].n).toBe(OLD_SHELVES.length);
	});

	it('leaves the database in the shape the baseline builds', async () => {
		const sql = await seedZeroSixTwo();
		await upgradeDocumentsV2(sql);

		const indexes = await sql<{ indexname: string }[]>`
			select indexname from pg_indexes where schemaname = 'public'`;
		const names = indexes.map((i) => i.indexname);
		expect(names).toContain('dtc_fts_idx');
		expect(names).toContain('dtc_trgm_idx');
		expect(names).toContain('document_name_trgm_idx');

		const tables = await sql<{ tablename: string }[]>`
			select tablename from pg_tables where schemaname = 'public'`;
		const tableNames = tables.map((t) => t.tablename);
		expect(tableNames).toContain('document_text');
		expect(tableNames).toContain('document_text_chunk');

		// The period CHECK travels with the columns, or an upgraded instance
		// accepts a subject the baseline would refuse.
		await expect(
			sql`insert into subject (id, name, active_from, active_to)
				values (gen_random_uuid(), 'Backwards', '2026-06-01', '2026-01-01')`
		).rejects.toThrow();
	});
});
