// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, count } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { document } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { visibleDocumentPredicate } from '$lib/server/documents/visibility';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument } from './fixtures';

/**
 * Restricted is an invariant, not a screen filter.
 *
 * A member must not be able to infer a restricted document from anything — not
 * a row, not a count that is one too high, not a calendar feed. That is why the
 * rule lives in one SQL fragment every read path applies, and why this suite
 * tests the fragment rather than any one screen.
 */
let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('document-visibility', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from document`;
});

async function seedDocuments(counts: { normal: number; restricted: number }): Promise<string[]> {
	const shelfId = await shelfIdByKey('household', testDb);
	const ids: string[] = [];
	for (const [sensitivity, n] of [
		['normal', counts.normal],
		['restricted', counts.restricted]
	] as const) {
		for (let i = 0; i < n; i++) {
			const id = uuidv7();
			ids.push(id);
			await makeDocument(testDb, {
				id,
				name: `${sensitivity} ${i}`,
				shelfId,
				type: 'other',
				sensitivity,
				addedOn: '2026-01-01'
			});
		}
	}
	return ids;
}

async function seedOneOfEach(): Promise<{ normal: string; restricted: string }> {
	const [normal, restricted] = await seedDocuments({ normal: 1, restricted: 1 });
	return { normal, restricted };
}

async function selectWith(predicate: SQL | undefined): Promise<string[]> {
	const rows = await testDb.select({ id: document.id }).from(document).where(and(predicate));
	return rows.map((r) => r.id);
}

async function countWith(predicate: SQL | undefined): Promise<number> {
	const [row] = await testDb.select({ n: count() }).from(document).where(and(predicate));
	return row.n;
}

describe('visibleDocumentPredicate', () => {
	it('adds nothing for an admin', () => {
		expect(visibleDocumentPredicate({ id: 'a', role: 'admin' })).toBeUndefined();
	});

	it('hides restricted documents from a member', async () => {
		const { normal, restricted } = await seedOneOfEach();
		const ids = await selectWith(visibleDocumentPredicate({ id: 'm', role: 'member' }));
		expect(ids).toContain(normal);
		expect(ids).not.toContain(restricted);
	});

	it('treats no actor as a member, not as an admin', async () => {
		// The ICS feed is token-authenticated and has no session person. A
		// predicate that read `null` as "unrestricted" would make the feed the
		// one place restricted paper leaks.
		const { restricted } = await seedOneOfEach();
		const ids = await selectWith(visibleDocumentPredicate(null));
		expect(ids).not.toContain(restricted);
	});

	it('counts after filtering, not before', async () => {
		await seedDocuments({ normal: 26, restricted: 1 });
		const n = await countWith(visibleDocumentPredicate({ id: 'm', role: 'member' }));
		expect(n).toBe(26);
	});

	it('shows an admin both', async () => {
		await seedDocuments({ normal: 26, restricted: 1 });
		expect(await countWith(visibleDocumentPredicate({ id: 'a', role: 'admin' }))).toBe(27);
	});
});
