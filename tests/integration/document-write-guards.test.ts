// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A write action may not name a document that is not there.
 *
 * Every one of these actions takes an id off a form and acts on it, and a form
 * is not a list: an id posted straight at `updateDocument`, `replaceFile`,
 * `continueExtraction`, `bulkUpdate`, `fileFromQueue` or tax's `detach` has
 * been through no read of the archive at all. So each asks `assertDocumentExists`
 * before it writes, and each answers 404 with the same sentence when the answer
 * is no — one guard, in `visibility.ts`, rather than six spellings of it that
 * can drift apart.
 *
 * This is what survives the per-document visibility rule: the household has one
 * kind of reader now, and everyone in it sees everything, but an id that names
 * nothing must still be refused rather than silently doing nothing.
 */
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { document, documentLink, taxStatement } from '$lib/server/db/schema';
import { shelfIdByKey, systemShelfId } from '$lib/server/documents/shelves';
import { NO_SUCH_DOCUMENT } from '$lib/server/documents/visibility';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;
let previousDirectory: string | undefined;
const DIRECTORY = resolve('scratch-workspace/document-write-guards-uploads');

const ROBERT = rowId('person-robert');
const FILED = rowId('doc-filed');
const OTHER = rowId('doc-other');
const STATEMENT = rowId('tax-statement');
/** An id of the right shape that names nothing at all. */
const MISSING = rowId('doc-missing');

const locals = {
	person: { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' as const, theme: null }
};

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('document-write-guards', { max: 1 });
	// The actions reach for the module-level `db`, so pointing that at this
	// suite's server is what makes the real actions reachable.
	previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	await rm(DIRECTORY, { recursive: true, force: true });
});

beforeEach(async () => {
	await harness.sql`truncate document, person, tax_statement cascade`;
	await makePerson(testDb, { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' });
});

async function seedDocument(id: string, name = 'Electricity bill'): Promise<void> {
	await makeDocument(testDb, {
		id,
		name,
		shelfId: await shelfIdByKey('income_tax', testDb),
		type: 'other',
		storedName: `${id}.pdf`,
		ext: 'PDF',
		addedOn: '2026-08-01'
	});
}

const rowFor = async (id: string) =>
	(await testDb.select().from(document).where(eq(document.id, id)))[0];

type ActionResult = { status?: number; data?: { message?: string }; ok?: boolean };

async function documentsAction(
	name: string,
	fields: Record<string, string | string[]>,
	files: { field: string; bytes: Uint8Array; name: string }[] = []
): Promise<ActionResult> {
	const { actions } = await import('../../src/routes/(app)/documents/+page.server');
	return callAction(actions, name, fields, files, 'documents');
}

async function taxAction(
	name: string,
	fields: Record<string, string | string[]>
): Promise<ActionResult> {
	const { actions } = await import('../../src/routes/(app)/tax/+page.server');
	return callAction(actions, name, fields, [], 'tax');
}

async function callAction(
	actions: Record<string, unknown>,
	name: string,
	fields: Record<string, string | string[]>,
	files: { field: string; bytes: Uint8Array; name: string }[],
	route: string
): Promise<ActionResult> {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value)) for (const one of value) form.append(key, one);
		else form.set(key, value);
	}
	for (const file of files) {
		form.append(
			file.field,
			new File([new Uint8Array(file.bytes)], file.name, { type: 'application/pdf' })
		);
	}
	const request = new Request(`http://localhost/${route}?/${name}`, { method: 'POST', body: form });
	return (await (actions[name] as (event: unknown) => Promise<unknown>)({
		request,
		locals
	})) as ActionResult;
}

describe('the inspector’s Save', () => {
	it('answers an id that names no document with 404', async () => {
		const outcome = await documentsAction('updateDocument', {
			id: MISSING,
			name: 'Renamed',
			type: 'other'
		});

		expect(outcome.status).toBe(404);
		expect(outcome.data?.message).toBe(NO_SUCH_DOCUMENT);
	});

	it('saves a document that is there', async () => {
		await seedDocument(FILED, 'Divorce papers');

		const outcome = await documentsAction('updateDocument', {
			id: FILED,
			name: 'Divorce papers 2026',
			type: 'other'
		});

		expect(outcome.status).toBeUndefined();
		expect((await rowFor(FILED)).name).toBe('Divorce papers 2026');
	});
});

describe('replacing the file behind a document', () => {
	const BYTES = new TextEncoder().encode('%PDF-1.4 different bytes');

	it('refuses an id that names no document, before any bytes are saved', async () => {
		await seedDocument(FILED);

		const outcome = await documentsAction('replaceFile', { id: MISSING }, [
			{ field: 'file', bytes: BYTES, name: 'other.pdf' }
		]);

		expect(outcome.status).toBe(404);
		expect(outcome.data?.message).toBe(NO_SUCH_DOCUMENT);
		const row = await rowFor(FILED);
		expect(row.storedName).toBe(`${FILED}.pdf`);
		expect(row.contentHash).toBeNull();
	});

	it('replaces the file behind a document that is there', async () => {
		await seedDocument(FILED);

		const outcome = await documentsAction('replaceFile', { id: FILED }, [
			{ field: 'file', bytes: BYTES, name: 'other.pdf' }
		]);

		expect(outcome.status).toBeUndefined();
		expect((await rowFor(FILED)).storedName).not.toBe(`${FILED}.pdf`);
	});
});

describe('asking for the next slice of a document’s text', () => {
	it('refuses an id that names no document', async () => {
		const outcome = await documentsAction('continueExtraction', { id: MISSING });

		expect(outcome.status).toBe(404);
		expect(outcome.data?.message).toBe(NO_SUCH_DOCUMENT);
	});

	it('does not refuse a document that is there', async () => {
		await seedDocument(FILED);

		const outcome = await documentsAction('continueExtraction', { id: FILED });

		expect(outcome.status).toBeUndefined();
	});
});

describe('the selection bar', () => {
	it('acts on the ids that are really there and drops the rest', async () => {
		await seedDocument(FILED);

		const outcome = await documentsAction('bulkUpdate', {
			ids: [MISSING, FILED],
			type: 'correspondence'
		});

		expect(outcome.status).toBeUndefined();
		expect((await rowFor(FILED)).type).toBe('correspondence');
	});

	it('answers 404 when none of the selection is there', async () => {
		const outcome = await documentsAction('bulkUpdate', {
			ids: [MISSING],
			type: 'correspondence'
		});

		expect(outcome.status).toBe(404);
		expect(outcome.data?.message).toBe(NO_SUCH_DOCUMENT);
	});

	it('retypes every document that is there', async () => {
		await seedDocument(FILED);
		await seedDocument(OTHER);

		await documentsAction('bulkUpdate', {
			ids: [FILED, OTHER],
			type: 'correspondence'
		});

		expect((await rowFor(FILED)).type).toBe('correspondence');
		expect((await rowFor(OTHER)).type).toBe('correspondence');
	});
});

describe('the inbox review flow', () => {
	it('refuses filing an id that names no document out of the inbox', async () => {
		const outcome = await documentsAction('fileFromQueue', {
			id: MISSING,
			shelf: 'income_tax',
			name: 'Filed',
			type: 'other'
		});

		expect(outcome.status).toBe(404);
		expect(outcome.data?.message).toBe(NO_SUCH_DOCUMENT);
	});

	it('files a document that is waiting in the inbox', async () => {
		await makeDocument(testDb, {
			id: FILED,
			name: 'Scan 004',
			shelfId: await systemShelfId('inbox', testDb),
			type: 'other',
			addedOn: '2026-08-01'
		});

		const outcome = await documentsAction('fileFromQueue', {
			id: FILED,
			shelf: 'income_tax',
			name: 'Electricity bill',
			type: 'other'
		});

		expect(outcome.status).toBeUndefined();
		const row = await rowFor(FILED);
		expect(row.name).toBe('Electricity bill');
		expect(row.shelfId).toBe(await shelfIdByKey('income_tax', testDb));
	});
});

describe('unfiling an attachment from a tax statement', () => {
	async function seedStatementWithPaper(): Promise<void> {
		await testDb.insert(taxStatement).values({
			id: STATEMENT,
			personId: ROBERT,
			year: 2026,
			country: 'CZ',
			currency: 'CZK',
			grossIncomeMinor: 100_000_00n,
			taxPaidMinor: 15_000_00n
		});
		await seedDocument(FILED);
		await testDb.insert(documentLink).values({ documentId: FILED, targetId: STATEMENT });
	}

	const linkRows = () =>
		testDb
			.select()
			.from(documentLink)
			.where(and(eq(documentLink.documentId, FILED), eq(documentLink.targetId, STATEMENT)));

	it('refuses an id that names no document, and the attachment stays attached', async () => {
		await seedStatementWithPaper();

		const outcome = await taxAction('detach', { targetId: STATEMENT, documentId: MISSING });

		expect(outcome.status).toBe(404);
		expect(outcome.data?.message).toBe(NO_SUCH_DOCUMENT);
		expect(await linkRows()).toHaveLength(1);
	});

	it('unfiles an attachment that is there', async () => {
		await seedStatementWithPaper();

		const outcome = await taxAction('detach', { targetId: STATEMENT, documentId: FILED });

		expect(outcome.status).toBeUndefined();
		expect(await linkRows()).toHaveLength(0);
	});
});
