// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Who may file, change or remove a tax statement.
 *
 * The rule is the payslip rule: a member acts on their own statements, an
 * administrator on anybody's. The person a statement is about is stated in the
 * form for a new one and read from the row for an existing one, and in both
 * cases the signed-in person has to be allowed to act for them — otherwise a
 * member could file, attach to, unlink from or delete another member's return.
 */
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { documentLink, taxStatement } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makePerson } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
const ADMIN = rowId('person-admin');
const PETRA = rowId('person-petra');
const ROBERT = rowId('person-robert');
const STATEMENT = rowId('tax-petra-2025');
const PAPER = rowId('doc-petra-2025');
const DIRECTORY = resolve('scratch-workspace/tax-guard-uploads');
let previousDirectory: string | undefined;
let previousUrl: string | undefined;

const asPerson = (id: string, role: 'admin' | 'member') => ({
	person: { id, name: 'Someone', initials: 'S', role, theme: null }
});

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('tax-statement-guard');
	previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = harness.url;
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
	await rm(DIRECTORY, { recursive: true, force: true });
});

beforeEach(async () => {
	await harness.sql`truncate document, person, tax_statement cascade`;
	await makePerson(testDb, { id: ADMIN, name: 'Admin', initials: 'A', role: 'admin' });
	await makePerson(testDb, { id: PETRA, name: 'Petra', initials: 'P', role: 'member' });
	await makePerson(testDb, { id: ROBERT, name: 'Robert', initials: 'R', role: 'member' });
});

/** Petra's 2025 return, with one piece of paper linked to it. */
async function seedPetrasStatement(): Promise<void> {
	await testDb.insert(taxStatement).values({
		id: STATEMENT,
		personId: PETRA,
		year: 2025,
		country: 'CZ',
		currency: 'CZK',
		grossIncomeMinor: 120_000_000n,
		taxPaidMinor: 18_000_000n
	});
	await makeDocument(testDb, {
		id: PAPER,
		name: '2025 CZ employer earnings report · Petra',
		shelfId: await shelfIdByKey('income_tax', testDb),
		type: 'tax_document',
		storedName: 'petra-2025.pdf',
		ext: 'PDF',
		addedOn: '2026-03-01'
	});
	await testDb.insert(documentLink).values({ documentId: PAPER, targetId: STATEMENT });
}

type ActionResult = { status?: number; data?: { message?: string }; ok?: boolean };

async function post(
	name: 'save' | 'attach' | 'detach' | 'deleteAttachment' | 'remove',
	fields: Record<string, string>,
	locals: ReturnType<typeof asPerson>,
	files: { field: string; bytes: Uint8Array; name: string }[] = []
): Promise<ActionResult> {
	const { actions } = await import('../../src/routes/(app)/tax/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	for (const file of files) {
		form.append(
			file.field,
			new File([new Uint8Array(file.bytes)], file.name, { type: 'application/pdf' })
		);
	}
	const request = new Request(`http://localhost/tax?/${name}`, { method: 'POST', body: form });
	return (await (actions[name] as unknown as (event: unknown) => Promise<unknown>)({
		request,
		locals
	})) as ActionResult;
}

const statements = () => testDb.select().from(taxStatement);
const links = () => testDb.select().from(documentLink).where(eq(documentLink.targetId, STATEMENT));
const PDF = new TextEncoder().encode('%PDF-1.4 a return');

describe('a member and somebody else’s statement', () => {
	it('cannot file one', async () => {
		const outcome = await post(
			'save',
			{ personId: PETRA, year: '2025', country: 'CZ', currency: 'CZK', gross: '1 200 000' },
			asPerson(ROBERT, 'member')
		);
		expect(outcome.status).toBe(403);
		expect(outcome.data?.message).toBe('You can only file your own tax statements.');
		expect(await statements()).toHaveLength(0);
	});

	it('cannot attach paper to one, and the upload is not kept', async () => {
		await seedPetrasStatement();
		const outcome = await post('attach', { id: STATEMENT }, asPerson(ROBERT, 'member'), [
			{ field: 'files', bytes: PDF, name: 'return.pdf' }
		]);
		expect(outcome.status).toBe(403);
		expect(await links()).toHaveLength(1);
	});

	it('cannot unlink its paper', async () => {
		await seedPetrasStatement();
		const outcome = await post(
			'detach',
			{ targetId: STATEMENT, documentId: PAPER },
			asPerson(ROBERT, 'member')
		);
		expect(outcome.status).toBe(403);
		expect(await links()).toHaveLength(1);
	});

	it('cannot delete its paper', async () => {
		await seedPetrasStatement();
		const outcome = await post(
			'deleteAttachment',
			{ documentId: PAPER },
			asPerson(ROBERT, 'member')
		);
		expect(outcome.status).toBe(403);
		expect(await links()).toHaveLength(1);
	});

	it('cannot remove it', async () => {
		await seedPetrasStatement();
		const outcome = await post('remove', { id: STATEMENT }, asPerson(ROBERT, 'member'));
		expect(outcome.status).toBe(403);
		expect(await statements()).toHaveLength(1);
	});

	it('is refused when nobody is signed in at all', async () => {
		await seedPetrasStatement();
		const outcome = await post('remove', { id: STATEMENT }, { person: null } as never);
		expect(outcome.status).toBe(403);
		expect(await statements()).toHaveLength(1);
	});
});

describe('a member and their own statement', () => {
	it('files it', async () => {
		const outcome = await post(
			'save',
			{ personId: ROBERT, year: '2025', country: 'CZ', currency: 'CZK', gross: '1 200 000' },
			asPerson(ROBERT, 'member')
		);
		expect(outcome.status).toBeUndefined();
		expect(outcome.ok).toBe(true);
		const [row] = await statements();
		expect(row.personId).toBe(ROBERT);
	});
});

describe('an administrator', () => {
	it('removes anybody’s statement', async () => {
		await seedPetrasStatement();
		const outcome = await post('remove', { id: STATEMENT }, asPerson(ADMIN, 'admin'));
		expect(outcome.status).toBeUndefined();
		expect(outcome.ok).toBe(true);
		expect(await statements()).toHaveLength(0);
	});

	it('still gets 404 for a statement that is not there', async () => {
		const outcome = await post('remove', { id: STATEMENT }, asPerson(ADMIN, 'admin'));
		expect(outcome.status).toBe(404);
	});
});
