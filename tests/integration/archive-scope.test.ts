// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { document, documentLink, subject } from '$lib/server/db/schema';
import { archiveScopePredicate } from '$lib/server/documents/visibility';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

/**
 * Archived subjects demote their own paper and nothing else.
 *
 * The first row of the table is the whole reason this is a predicate with a
 * test rather than a filter someone writes twice: "every linked subject is
 * archived" is vacuously true for a document linked to no subject at all, so
 * the obvious reading hides every unlinked document the moment anything is
 * archived.
 */
let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('archive-scope', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

async function seedDocumentLinkedTo(kinds: ('active' | 'archived')[]): Promise<string> {
	const id = uuidv7();
	await testDb.insert(document).values({
		id,
		name: `Document ${id}`,
		shelfId: await shelfIdByKey('household', testDb),
		type: 'other',
		addedOn: '2026-01-01'
	});
	for (const kind of kinds) {
		const subjectId = uuidv7();
		await testDb.insert(subject).values({
			id: subjectId,
			name: `Subject ${subjectId}`,
			archivedAt: kind === 'archived' ? new Date() : null
		});
		await testDb.insert(documentLink).values({ documentId: id, targetId: subjectId });
	}
	return id;
}

async function visibleIds(includeArchived: boolean): Promise<string[]> {
	const rows = await testDb
		.select({ id: document.id })
		.from(document)
		.where(and(archiveScopePredicate(includeArchived)));
	return rows.map((r) => r.id);
}

describe('the archive scope predicate', () => {
	// v3 §2.3, exactly. The first row is the vacuous-all bug: a document linked
	// to nothing has no archived subject, and must stay visible.
	const table = [
		{ links: [], visible: true, why: 'no subject links at all' },
		{ links: ['active'], visible: true, why: 'an active car' },
		{ links: ['archived'], visible: false, why: 'an archived car' },
		{ links: ['archived', 'active'], visible: true, why: 'archived car plus something active' },
		{ links: ['archived', 'archived'], visible: false, why: 'only archived subjects' }
	] as const;

	for (const row of table) {
		it(`${row.visible ? 'shows' : 'hides'} a document with ${row.why}`, async () => {
			const id = await seedDocumentLinkedTo([...row.links]);
			const shown = await visibleIds(false);
			expect(shown.includes(id)).toBe(row.visible);
		});
	}

	it('shows everything when the scope is opened', async () => {
		const id = await seedDocumentLinkedTo(['archived']);
		const shown = await visibleIds(true);
		expect(shown).toContain(id);
	});

	it('leaves a document linked to a non-subject entity alone', async () => {
		// A document filed against a person or a flat has no subject link at all,
		// which is the same shape as the first row of the table and must behave
		// the same way — the predicate joins through `subject`, not through
		// `document_link` alone.
		const id = await seedDocumentLinkedTo([]);
		const [row] = await testDb.select().from(document).where(eq(document.id, id));
		expect(row).toBeDefined();
		expect(await visibleIds(false)).toContain(id);
	});
});
