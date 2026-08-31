// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { document, documentLink, subject } from '$lib/server/db/schema';
import { archiveScopePredicate } from '$lib/server/documents/visibility';

import { buildBriefing } from '$lib/server/briefing';
import { generateEvents } from '$lib/server/calendar';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument } from './fixtures';

// `documentExpiry` (the briefing source) takes no handle and always reads the
// module-level `db` singleton, so it has to be pointed at this harness the
// same way `restricted-read-paths.test.ts` does it — `generateEvents` takes an
// explicit handle and needs none of this.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

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
let previousUrl: string | undefined;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('archive-scope', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

async function seedDocumentLinkedTo(kinds: ('active' | 'archived')[]): Promise<string> {
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name: `Document ${id}`,
		shelfKey: 'household',
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

/** Far enough out to be a briefing item and a calendar event, not so far it falls off either window. */
const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

/** A document with an expiry date, linked to subjects of the given kinds — the sold-car shape from docs/documents.md. */
async function seedExpiringDocumentLinkedTo(
	name: string,
	kinds: ('active' | 'archived')[]
): Promise<string> {
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name,
		shelfKey: 'household',
		type: 'other',
		expiresOn: soon,
		expiryVerb: 'expires',
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

describe('the briefing applies the same scope', () => {
	// docs/documents.md promises that a sold car's insurance renewal stops
	// appearing on the Overview once the car (its only subject) is archived.
	it('drops a document whose only subject link is archived, and keeps one with an active link', async () => {
		await seedExpiringDocumentLinkedTo('Car insurance · sold Skoda', ['archived']);
		await seedExpiringDocumentLinkedTo('Car insurance · household Volvo', ['active']);
		const { items } = await buildBriefing(null);
		const titles = items.map((i) => i.title).join(' | ');
		expect(titles).not.toMatch(/sold Skoda/);
		expect(titles).toMatch(/household Volvo/);
	});
});

describe('calendar generation applies the same scope', () => {
	it('emits no expiry event for a document whose only subject link is archived, and keeps one with an active link', async () => {
		await seedExpiringDocumentLinkedTo('Car insurance · sold Skoda', ['archived']);
		await seedExpiringDocumentLinkedTo('Car insurance · household Volvo', ['active']);
		const events = await generateEvents('2020-01-01', '2099-01-01', testDb);
		const labels = events.map((e) => e.label).join(' | ');
		expect(labels).not.toMatch(/sold Skoda/);
		expect(labels).toMatch(/household Volvo/);
	});
});
