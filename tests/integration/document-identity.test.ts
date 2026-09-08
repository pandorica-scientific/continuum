// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What an identity document says on its face, written through the real action.
 *
 * The fields are hand-entered and the row is keyed by the document, which makes
 * two things worth holding: that a save writes them at all, and that a change
 * of type does not throw them away. The second is the one that would go wrong
 * silently — a dropdown set to Other by mistake, five fields gone, and nothing
 * on screen to say they were ever there.
 */
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { documentIdentity, documentIdentityNumber } from '$lib/server/db/schema';
import { loadQueue } from '$lib/server/documents/queue-load';
import { shelfIdByKey } from '$lib/server/documents/shelves';
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
const DIRECTORY = resolve('scratch-workspace/document-identity-uploads');

const ROBERT = rowId('person-robert');
const PASSPORT = rowId('doc-passport');
/** An id of the right shape that names nothing at all. */
const MISSING = rowId('doc-missing');

const asAdmin = {
	person: { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' as const, theme: null }
};

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('document-identity', { max: 1 });
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
	await harness.sql`truncate document, person cascade`;
	await makePerson(testDb, { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' });
	await makeDocument(testDb, {
		id: PASSPORT,
		name: 'Passport',
		shelfId: await shelfIdByKey('identity', testDb),
		type: 'id_document',
		storedName: `${PASSPORT}.pdf`,
		ext: 'PDF',
		addedOn: '2026-08-01'
	});
});

type ActionResult = { status?: number; data?: { message?: string }; ok?: boolean };

async function save(
	fields: Record<string, string | string[]>,
	locals: typeof asAdmin = asAdmin
): Promise<ActionResult> {
	const { actions } = await import('../../src/routes/(app)/documents/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value)) for (const one of value) form.append(key, one);
		else form.set(key, value);
	}
	const request = new Request('http://localhost/documents?/updateDocument', {
		method: 'POST',
		body: form
	});
	return (await (actions.updateDocument as (event: unknown) => Promise<unknown>)({
		request,
		locals
	})) as ActionResult;
}

const identityOf = async (id: string) =>
	(await testDb.select().from(documentIdentity).where(eq(documentIdentity.documentId, id)))[0];

const PASSPORT_FIELDS = {
	id: PASSPORT,
	name: 'Passport',
	shelf: 'identity',
	type: 'id_document',
	identityKind: 'passport',
	identityCountry: 'CZ',
	identityNumber: '12345678',
	identityIssuedOn: '2022-05-02',
	identityIssuer: 'Magistrát hl. m. Prahy'
};

describe('saving an identity document', () => {
	it('writes the five fields', async () => {
		await save(PASSPORT_FIELDS);

		expect(await identityOf(PASSPORT)).toMatchObject({
			kind: 'passport',
			country: 'CZ',
			number: '12345678',
			issuedOn: '2022-05-02',
			issuer: 'Magistrát hl. m. Prahy'
		});
	});

	it('updates rather than refusing the second save', async () => {
		await save(PASSPORT_FIELDS);
		await save({ ...PASSPORT_FIELDS, identityNumber: '87654321', identityKind: 'id_card' });

		const rows = await testDb
			.select()
			.from(documentIdentity)
			.where(eq(documentIdentity.documentId, PASSPORT));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'id_card', number: '87654321' });
	});

	it('clears a field the person emptied', async () => {
		await save(PASSPORT_FIELDS);
		await save({ ...PASSPORT_FIELDS, identityNumber: '', identityIssuedOn: '' });

		expect(await identityOf(PASSPORT)).toMatchObject({ number: null, issuedOn: null });
	});

	it('normalises the country and refuses what is not a code', async () => {
		await save({ ...PASSPORT_FIELDS, identityCountry: 'cz' });
		expect((await identityOf(PASSPORT)).country).toBe('CZ');

		// Stored as null rather than as something only the picker could read: the
		// flag, the artwork lookup and the CHECK all expect two upper-case letters.
		await save({ ...PASSPORT_FIELDS, identityCountry: 'Czechia' });
		expect((await identityOf(PASSPORT)).country).toBeNull();
	});

	it('falls back to `other` for a kind outside the list', async () => {
		await save({ ...PASSPORT_FIELDS, identityKind: 'visa' });
		expect((await identityOf(PASSPORT)).kind).toBe('other');
	});
});

describe('a document that stops being an identity document', () => {
	it('keeps what was typed off its face', async () => {
		// The screen stops showing the fields; the database keeps them. Retyping
		// back is how they come back, rather than being asked for a second time.
		await save(PASSPORT_FIELDS);
		await save({ id: PASSPORT, name: 'Passport', shelf: 'identity', type: 'other' });

		expect(await identityOf(PASSPORT)).toMatchObject({ number: '12345678', country: 'CZ' });
	});

	it('is not given identity fields it did not ask for', async () => {
		await save({
			id: PASSPORT,
			name: 'Some contract',
			shelf: 'identity',
			type: 'contract',
			identityKind: 'passport',
			identityCountry: 'CZ'
		});

		expect(await identityOf(PASSPORT)).toBeUndefined();
	});
});

describe('the existence guard', () => {
	it('refuses an id that names no document, and writes nothing', async () => {
		const result = await save({ ...PASSPORT_FIELDS, id: MISSING });

		expect(result.status).toBe(404);
		expect(result.data?.message).toBe(NO_SUCH_DOCUMENT);
		expect(await identityOf(MISSING)).toBeUndefined();
	});
});

describe('the identity row', () => {
	it('goes when the document goes', async () => {
		await save(PASSPORT_FIELDS);
		await harness.sql`delete from document where id = ${PASSPORT}`;

		expect(await identityOf(PASSPORT)).toBeUndefined();
	});
});

const numbersOf = async (id: string) =>
	testDb
		.select({
			ordinal: documentIdentityNumber.ordinal,
			label: documentIdentityNumber.label,
			value: documentIdentityNumber.value
		})
		.from(documentIdentityNumber)
		.where(eq(documentIdentityNumber.documentId, id))
		.orderBy(documentIdentityNumber.ordinal);

describe('the other numbers a document carries', () => {
	it('keeps as many as were typed, in the order they were typed', async () => {
		// A residence permit really does carry a card number and a personal
		// number, and there is no ceiling worth guessing at.
		await save({
			...PASSPORT_FIELDS,
			identityExtraLabel: ['Card number', 'Personal number'],
			identityExtraValue: ['CZ-8891', '905612/3344']
		});

		expect(await numbersOf(PASSPORT)).toEqual([
			{ ordinal: 0, label: 'Card number', value: 'CZ-8891' },
			{ ordinal: 1, label: 'Personal number', value: '905612/3344' }
		]);
	});

	it('replaces the set rather than adding to it', async () => {
		await save({
			...PASSPORT_FIELDS,
			identityExtraLabel: ['Card number', 'Personal number'],
			identityExtraValue: ['CZ-8891', '905612/3344']
		});
		await save({
			...PASSPORT_FIELDS,
			identityExtraLabel: ['Personal number'],
			identityExtraValue: ['905612/3344']
		});

		// Re-numbered from the form's order, so removing the first of two leaves
		// 0 rather than a gap the next insert would collide with.
		expect(await numbersOf(PASSPORT)).toEqual([
			{ ordinal: 0, label: 'Personal number', value: '905612/3344' }
		]);
	});

	it('drops a row with only one half filled in', async () => {
		// A label naming nothing, or a number nobody can read back.
		await save({
			...PASSPORT_FIELDS,
			identityExtraLabel: ['Card number', '', 'Personal number'],
			identityExtraValue: ['CZ-8891', '77', '']
		});

		expect(await numbersOf(PASSPORT)).toEqual([
			{ ordinal: 0, label: 'Card number', value: 'CZ-8891' }
		]);
	});

	it('clears them when every row is emptied', async () => {
		await save({
			...PASSPORT_FIELDS,
			identityExtraLabel: ['Card number'],
			identityExtraValue: ['CZ-8891']
		});
		await save({ ...PASSPORT_FIELDS, identityExtraLabel: [''], identityExtraValue: [''] });

		expect(await numbersOf(PASSPORT)).toEqual([]);
	});

	it('goes when the document goes', async () => {
		await save({
			...PASSPORT_FIELDS,
			identityExtraLabel: ['Card number'],
			identityExtraValue: ['CZ-8891']
		});
		await harness.sql`delete from document where id = ${PASSPORT}`;

		expect(await numbersOf(PASSPORT)).toEqual([]);
	});
});

/**
 * Filing from the Inbox writes the same fields the inspector does.
 *
 * It did not, and the failure was quiet: a passport filed from the Inbox
 * reached the wallet with no kind and no country, which is generic artwork, no
 * flag and a card titled "Identity document" — a styling bug to look at, and a
 * missing write in fact. Both screens now post the same inputs and this action
 * reads them the same way.
 */
async function file(fields: Record<string, string | string[]>): Promise<ActionResult> {
	const { actions } = await import('../../src/routes/(app)/documents/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		if (Array.isArray(value)) for (const one of value) form.append(key, one);
		else form.set(key, value);
	}
	const request = new Request('http://localhost/documents?/fileFromQueue', {
		method: 'POST',
		body: form
	});
	return (await (actions.fileFromQueue as (event: unknown) => Promise<unknown>)({
		request,
		locals: asAdmin
	})) as ActionResult;
}

describe('filing an identity document from the Inbox', () => {
	it('writes the five fields', async () => {
		await file({
			id: PASSPORT,
			name: 'Passport',
			shelf: 'identity',
			type: 'id_document',
			identityKind: 'passport',
			identityCountry: 'PL',
			identityNumber: 'ZS3609',
			identityIssuedOn: '2020-09-01',
			identityIssuer: 'Wojewoda Mazowiecki'
		});

		expect(await identityOf(PASSPORT)).toMatchObject({
			kind: 'passport',
			country: 'PL',
			number: 'ZS3609',
			issuedOn: '2020-09-01',
			issuer: 'Wojewoda Mazowiecki'
		});
	});

	it('writes the other numbers too', async () => {
		await file({
			id: PASSPORT,
			name: 'Residence permit',
			shelf: 'identity',
			type: 'id_document',
			identityKind: 'residence_permit',
			identityCountry: 'CZ',
			identityExtraLabel: ['Card number'],
			identityExtraValue: ['CZ-8891']
		});

		expect(await numbersOf(PASSPORT)).toEqual([
			{ ordinal: 0, label: 'Card number', value: 'CZ-8891' }
		]);
	});

	it('does not give identity fields to paper that is not an identity document', async () => {
		await file({
			id: PASSPORT,
			name: 'Some contract',
			shelf: 'identity',
			type: 'contract',
			identityKind: 'passport',
			identityCountry: 'CZ'
		});

		expect(await identityOf(PASSPORT)).toBeUndefined();
	});
});

/**
 * The filing form is seeded, because filing WRITES these fields.
 *
 * Both screens treat the whole form as the intended state — a blank box means
 * cleared, which is how a field is emptied — so a filing form that always
 * started blank would post over a document somebody had already filled in and
 * delete its extra numbers on the way past. Nothing on screen would say so.
 */
describe('what the Inbox is handed about the current document', () => {
	it('carries what the document already says, so the form can show it', async () => {
		await save({
			...PASSPORT_FIELDS,
			identityExtraLabel: ['Card number'],
			identityExtraValue: ['CZ-8891']
		});
		// Back to the Inbox after the save, which files it onto Identity.
		await harness.sql`update document set shelf_id = ${await shelfIdByKey('inbox', testDb)} where id = ${PASSPORT}`;

		const queue = await loadQueue(testDb, '2026-09-08', PASSPORT);

		expect(queue.current).toBe(PASSPORT);
		expect(queue.currentIdentity?.fields).toMatchObject({
			kind: 'passport',
			country: 'CZ',
			number: '12345678'
		});
		expect(queue.currentIdentity?.numbers).toEqual([{ label: 'Card number', value: 'CZ-8891' }]);
	});

	it('says nothing about a document that has typed nothing', async () => {
		await harness.sql`update document set shelf_id = ${await shelfIdByKey('inbox', testDb)} where id = ${PASSPORT}`;

		const queue = await loadQueue(testDb, '2026-09-08', PASSPORT);

		expect(queue.current).toBe(PASSPORT);
		expect(queue.currentIdentity).toBeNull();
	});
});
