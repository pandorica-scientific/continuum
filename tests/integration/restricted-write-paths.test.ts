// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Restricted paper cannot be WRITTEN by a member either.
 *
 * `restricted-read-paths` holds the other half: a member never learns a
 * restricted document exists. That rule is worth little on its own if the
 * screens' write actions take an id and act on it — a member who came by one
 * could rename it, retype it, put different bytes behind it, or unfile it from
 * a tax statement, none of which needs the row ever to have been listed.
 *
 * The answer is the same everywhere and is a 404, never a 403: "you may not"
 * would confirm the document exists, which is the one fact the rule protects.
 */
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { document, documentLink, person, taxStatement } from '$lib/server/db/schema';
import { shelfIdByKey, systemShelfId } from '$lib/server/documents/shelves';
import { NO_SUCH_DOCUMENT } from '$lib/server/documents/visibility';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;
let previousDirectory: string | undefined;
const DIRECTORY = resolve('scratch-workspace/restricted-write-paths-uploads');

const ROBERT = rowId('person-robert');
const RESTRICTED = rowId('doc-restricted');
const ORDINARY = rowId('doc-ordinary');
const STATEMENT = rowId('tax-statement');

const asAdmin = {
	person: { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' as const, theme: null }
};
const asMember = {
	person: { id: ROBERT, name: 'Robert', initials: 'R', role: 'member' as const, theme: null }
};

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('restricted-write-paths', { max: 1 });
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
	await testDb.insert(person).values({ id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' });
});

async function seedDocument(
	id: string,
	sensitivity: 'normal' | 'restricted',
	shelfKey = 'finance'
): Promise<void> {
	await testDb.insert(document).values({
		id,
		name: sensitivity === 'restricted' ? 'Divorce papers' : 'Electricity bill',
		shelfId: await shelfIdByKey(shelfKey, testDb),
		type: 'other',
		storedName: `${id}.pdf`,
		ext: 'PDF',
		addedOn: '2026-08-01',
		sensitivity
	});
}

const rowFor = async (id: string) =>
	(await testDb.select().from(document).where(eq(document.id, id)))[0];

type ActionResult = { status?: number; data?: { message?: string }; ok?: boolean };

async function documentsAction(
	name: string,
	fields: Record<string, string | string[]>,
	locals: typeof asAdmin | typeof asMember,
	files: { field: string; bytes: Uint8Array; name: string }[] = []
): Promise<ActionResult> {
	const { actions } = await import('../../src/routes/(app)/documents/+page.server');
	return callAction(actions, name, fields, locals, files, 'documents');
}

async function reviewAction(
	name: string,
	fields: Record<string, string | string[]>,
	locals: typeof asAdmin | typeof asMember
): Promise<ActionResult> {
	const { actions } = await import('../../src/routes/(app)/documents/review/+page.server');
	return callAction(actions, name, fields, locals, [], 'documents/review');
}

async function taxAction(
	name: string,
	fields: Record<string, string | string[]>,
	locals: typeof asAdmin | typeof asMember
): Promise<ActionResult> {
	const { actions } = await import('../../src/routes/(app)/tax/+page.server');
	return callAction(actions, name, fields, locals, [], 'tax');
}

async function callAction(
	actions: Record<string, unknown>,
	name: string,
	fields: Record<string, string | string[]>,
	locals: typeof asAdmin | typeof asMember,
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
	it('answers a member naming a restricted document the way it answers a missing one', async () => {
		await seedDocument(RESTRICTED, 'restricted');

		const outcome = await documentsAction(
			'updateDocument',
			{ id: RESTRICTED, name: 'Renamed by a member', type: 'other' },
			asMember
		);

		expect(outcome.status).toBe(404);
		expect(outcome.data?.message).toBe(NO_SUCH_DOCUMENT);
		expect((await rowFor(RESTRICTED)).name).toBe('Divorce papers');
	});

	it('lets an admin save it', async () => {
		await seedDocument(RESTRICTED, 'restricted');

		const outcome = await documentsAction(
			'updateDocument',
			{ id: RESTRICTED, name: 'Divorce papers 2026', type: 'other' },
			asAdmin
		);

		expect(outcome.status).toBeUndefined();
		expect((await rowFor(RESTRICTED)).name).toBe('Divorce papers 2026');
	});
});

describe('replacing the file behind a document', () => {
	const BYTES = new TextEncoder().encode('%PDF-1.4 different bytes');

	it('refuses a member holding a restricted id, and the bytes stay where they were', async () => {
		await seedDocument(RESTRICTED, 'restricted');

		const outcome = await documentsAction('replaceFile', { id: RESTRICTED }, asMember, [
			{ field: 'file', bytes: BYTES, name: 'other.pdf' }
		]);

		expect(outcome.status).toBe(404);
		expect(outcome.data?.message).toBe(NO_SUCH_DOCUMENT);
		const row = await rowFor(RESTRICTED);
		expect(row.storedName).toBe(`${RESTRICTED}.pdf`);
		expect(row.contentHash).toBeNull();
	});

	it('lets an admin replace it', async () => {
		await seedDocument(RESTRICTED, 'restricted');

		const outcome = await documentsAction('replaceFile', { id: RESTRICTED }, asAdmin, [
			{ field: 'file', bytes: BYTES, name: 'other.pdf' }
		]);

		expect(outcome.status).toBeUndefined();
		expect((await rowFor(RESTRICTED)).storedName).not.toBe(`${RESTRICTED}.pdf`);
	});
});

describe('asking for the next slice of a document’s text', () => {
	it('refuses a member holding a restricted id', async () => {
		await seedDocument(RESTRICTED, 'restricted');

		const outcome = await documentsAction('continueExtraction', { id: RESTRICTED }, asMember);

		expect(outcome.status).toBe(404);
		expect(outcome.data?.message).toBe(NO_SUCH_DOCUMENT);
	});

	it('does not refuse an admin', async () => {
		await seedDocument(RESTRICTED, 'restricted');

		const outcome = await documentsAction('continueExtraction', { id: RESTRICTED }, asAdmin);

		expect(outcome.status).toBeUndefined();
	});
});

describe('the selection bar', () => {
	it('acts on the documents the member can see and leaves the rest alone', async () => {
		await seedDocument(RESTRICTED, 'restricted');
		await seedDocument(ORDINARY, 'normal');

		const outcome = await documentsAction(
			'bulkUpdate',
			{ ids: [RESTRICTED, ORDINARY], type: 'correspondence' },
			asMember
		);

		expect(outcome.status).toBeUndefined();
		expect((await rowFor(ORDINARY)).type).toBe('correspondence');
		expect((await rowFor(RESTRICTED)).type).toBe('other');
	});

	it('retypes both for an admin', async () => {
		await seedDocument(RESTRICTED, 'restricted');
		await seedDocument(ORDINARY, 'normal');

		await documentsAction(
			'bulkUpdate',
			{ ids: [RESTRICTED, ORDINARY], type: 'correspondence' },
			asAdmin
		);

		expect((await rowFor(RESTRICTED)).type).toBe('correspondence');
		expect((await rowFor(ORDINARY)).type).toBe('correspondence');
	});
});

describe('the inbox review flow', () => {
	it('refuses a member filing a restricted document out of the inbox', async () => {
		await testDb.insert(document).values({
			id: RESTRICTED,
			name: 'Divorce papers',
			shelfId: await systemShelfId('inbox', testDb),
			type: 'other',
			addedOn: '2026-08-01',
			sensitivity: 'restricted'
		});

		const outcome = await reviewAction(
			'file',
			{ id: RESTRICTED, shelf: 'finance', name: 'Filed by a member', type: 'other' },
			asMember
		);

		expect(outcome.status).toBe(404);
		expect(outcome.data?.message).toBe(NO_SUCH_DOCUMENT);
		const row = await rowFor(RESTRICTED);
		expect(row.name).toBe('Divorce papers');
		expect(row.shelfId).toBe(await systemShelfId('inbox', testDb));
	});
});

describe('unfiling a restricted attachment from a tax statement', () => {
	async function seedStatementWithRestrictedPaper(): Promise<void> {
		await testDb.insert(taxStatement).values({
			id: STATEMENT,
			personId: ROBERT,
			year: 2026,
			country: 'CZ',
			currency: 'CZK',
			grossIncomeMinor: 100_000_00n,
			taxPaidMinor: 15_000_00n
		});
		await seedDocument(RESTRICTED, 'restricted');
		await testDb.insert(documentLink).values({ documentId: RESTRICTED, targetId: STATEMENT });
	}

	const linkRows = () =>
		testDb
			.select()
			.from(documentLink)
			.where(and(eq(documentLink.documentId, RESTRICTED), eq(documentLink.targetId, STATEMENT)));

	it('refuses a member, and the attachment stays attached', async () => {
		await seedStatementWithRestrictedPaper();

		const outcome = await taxAction(
			'detach',
			{ targetId: STATEMENT, documentId: RESTRICTED },
			asMember
		);

		expect(outcome.status).toBe(404);
		expect(await linkRows()).toHaveLength(1);
	});

	it('lets an admin unfile it', async () => {
		await seedStatementWithRestrictedPaper();

		const outcome = await taxAction(
			'detach',
			{ targetId: STATEMENT, documentId: RESTRICTED },
			asAdmin
		);

		expect(outcome.status).toBeUndefined();
		expect(await linkRows()).toHaveLength(0);
	});
});
