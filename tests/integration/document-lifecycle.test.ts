// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The accepted statement filed on the Statements shelf and the import that
 * produced it used to share one file on disk with nothing keying one row to
 * the other, so deleting the document from the Documents screen deleted the
 * import's only original out from under it. `import_file.document_id`
 * (ON DELETE RESTRICT, added in Task 1) closes that gap: this suite checks the
 * id is written in the same transaction that files the document, and that
 * `deleteDocument` is refused — verbatim message, row and file both left
 * exactly where they were — rather than quietly losing an import's evidence.
 *
 * Task 9 adds the payslip/salary half below. Deleting a payslip is not a
 * document operation at all: the month it evidenced hangs off it, and the FK's
 * SET NULL either orphans that row or collides with the partial unique index
 * that keeps one unclaimed row per month. `removeDocument` is the whole
 * removal — salary first, paper second, file last — and this is where both
 * halves are held together.
 */
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import {
	document,
	documentLink,
	importFile,
	salaryEntry,
	transaction
} from '$lib/server/db/schema';
import { ingestFile } from '$lib/server/import/ingest';
import { deleteDocument } from '$lib/server/documents/mutations';
import { removeDocument } from '$lib/server/documents/lifecycle';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { recordSalary } from '$lib/server/salary';
import { saveUploadBytes, uploadSize } from '$lib/server/system/files';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeDocument, makePerson, makeTransaction } from './fixtures';

// $env/dynamic/private snapshots process.env when Vite builds the virtual
// module, which is before this suite picks the directory its uploads live in.
// A live getter is the only way `saveUploadBytes`/`readUpload` see the files
// written under the directory this suite chose rather than ./data.
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
const DIRECTORY = resolve('scratch-workspace/document-lifecycle-uploads');
let previousDirectory: string | undefined;
let previousUrl: string | undefined;
let STATEMENT_BYTES: Uint8Array;

beforeAll(async () => {
	previousDirectory = process.env.UPLOAD_DIR;
	process.env.UPLOAD_DIR = DIRECTORY;
	await mkdir(DIRECTORY, { recursive: true });
	harness = await startPostgres('document-lifecycle');
	// The inspector's guards are tested through the page's own action, and an
	// action holds no handle to pass — it reaches for `db`. Pointing that at
	// this suite's server is what makes the real action reachable.
	previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = harness.url;
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
	STATEMENT_BYTES = new Uint8Array(await readFile(resolve('tests/fixtures/fio.csv')));
}, 120_000);

afterAll(async () => {
	await harness?.stop();
	if (previousDirectory === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousDirectory;
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
	await rm(DIRECTORY, { recursive: true, force: true });
});

beforeEach(async () => {
	await harness.sql`truncate table entity, person, property, account, document, job,
		import_file, tax_statement restart identity cascade`;
});

/**
 * Ingest one accepted statement through the real ingest path and return the
 * ids Task 9 also needs: the import row, the document filed for it on the
 * Statements shelf, and the name of the file on disk behind both.
 */
async function ingestOneStatement(
	accountId: string,
	label = 'fio'
): Promise<{ importFileId: string; documentId: string; storedName: string }> {
	await makeAccount(testDb, {
		id: accountId,
		name: 'Fio',
		bank: 'fio',
		currency: 'CZK',
		numbers: ['1234567890/2010']
	});

	await ingestFile(`${label}.csv`, STATEMENT_BYTES, accountId, testDb);

	const [importRow] = await testDb.select().from(importFile);
	const [documentRow] = await testDb.select().from(document);
	if (!importRow || !documentRow) throw new Error('ingest did not file a statement as expected');
	return {
		importFileId: importRow.id,
		documentId: importRow.documentId ?? '',
		storedName: documentRow.storedName ?? ''
	};
}

describe('import_file.document_id', () => {
	it('is written, in the ingest transaction, to the document filed on the Statements shelf', async () => {
		const { importFileId, documentId } = await ingestOneStatement(rowId('account-fio-write'));

		expect(documentId).not.toBe('');

		const [documentRow] = await testDb.select().from(document);
		expect(documentRow.id).toBe(documentId);

		const [importRow] = await testDb
			.select()
			.from(importFile)
			.where(eq(importFile.id, importFileId));
		expect(importRow.documentId).toBe(documentRow.id);
	});

	it('refuses to delete the statement behind an import, leaving the row and the file in place', async () => {
		const { documentId, storedName } = await ingestOneStatement(rowId('account-fio-delete'));
		expect(await uploadSize(storedName)).not.toBeNull();

		const outcome = await deleteDocument(documentId, testDb);
		expect(outcome).toEqual({ ok: false, removedFile: false, refused: true });

		const [documentRow] = await testDb.select().from(document).where(eq(document.id, documentId));
		expect(documentRow).toBeDefined();
		expect(documentRow.storedName).toBe(storedName);
		// The file itself must not be removed on a refused delete: `deleteDocument`
		// only unlinks a stored upload after its row is gone, and here the row
		// never went — the FK violation stops the DELETE before it commits.
		expect(await uploadSize(storedName)).not.toBeNull();
	});
});

/**
 * The household behind the payslip cases: one admin, one member, and the
 * current account a salary is paid into.
 */
const ROBERT = rowId('dl-robert');
const KSENIYA = rowId('dl-kseniya');
const ACCOUNT = rowId('dl-account');
const CREDIT = rowId('dl-credit');
const SLIP = rowId('dl-slip');

/** Who is asking. Restricted paper is absent to the second of these. */
const ADMIN = { id: ROBERT, role: 'admin' } as const;
const MEMBER = { id: KSENIYA, role: 'member' } as const;

/** Four bytes that are a real file on the volume, which is all these need. */
const PAYSLIP_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const NOT_THERE = 'That document is not there.';
const CARRIES_AN_ENTRY =
	'This payslip carries a salary entry; delete it from the Salary screen to unhook it.';

async function seedHousehold(): Promise<void> {
	await makePerson(testDb, { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' });
	await makePerson(testDb, { id: KSENIYA, name: 'Kseniya', initials: 'K', role: 'member' });
	await makeAccount(testDb, {
		id: ACCOUNT,
		name: 'Current',
		bank: 'fio',
		kind: 'current',
		currency: 'CZK'
	});
}

/**
 * A salary credit in the ledger, recorded as the month's net.
 *
 * It lands FIRST, because that is what produces the row a payslip then claims:
 * the credit makes the month's one unclaimed row, and the slip fills its gross
 * in rather than opening a second row beside it.
 */
async function bankCredit(periodMonth: string, netMinor: bigint): Promise<void> {
	await makeTransaction(testDb, {
		id: CREDIT,
		accountId: ACCOUNT,
		bookedOn: `${periodMonth}-05`,
		amountMinor: netMinor,
		currency: 'CZK',
		counterparty: 'Acme s.r.o.',
		dedupFingerprint: `dl-credit-${periodMonth}`
	});
	expect(
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth,
				currency: 'CZK',
				netMinor,
				source: 'statement',
				transactionId: CREDIT
			},
			testDb
		)
	).toEqual({ ok: true });
}

/** A payslip on the Finance shelf, with a file behind it and a month recorded. */
async function payslip(
	periodMonth: string,
	grossMinor: bigint,
	id = SLIP
): Promise<{ id: string; storedName: string }> {
	const storedName = await saveUploadBytes(PAYSLIP_BYTES, 'payslip.pdf');
	await makeDocument(testDb, {
		id,
		name: `Payslip ${periodMonth} · Robert`,
		shelfKey: 'finance',
		type: 'payslip',
		storedName,
		ext: 'PDF',
		addedOn: '2026-08-25',
		periodOn: `${periodMonth}-01`
	});
	await testDb.insert(documentLink).values({ documentId: id, targetId: ROBERT });
	expect(
		await recordSalary(
			{
				personId: ROBERT,
				periodMonth,
				currency: 'CZK',
				grossMinor,
				source: 'payslip',
				documentId: id
			},
			testDb
		)
	).toEqual({ ok: true });
	return { id, storedName };
}

const rowsFor = (periodMonth: string) =>
	testDb
		.select()
		.from(salaryEntry)
		.where(and(eq(salaryEntry.personId, ROBERT), eq(salaryEntry.periodMonth, periodMonth)));

describe('removing a payslip', () => {
	it('takes its salary row and re-records the bank credit that had been merged into it', async () => {
		await seedHousehold();
		await bankCredit('2026-07', 5_231_000n);
		const slip = await payslip('2026-07', 6_840_000n);

		// One row, evidenced twice: the slip states the gross, the credit the net.
		const merged = await rowsFor('2026-07');
		expect(merged).toHaveLength(1);
		expect(merged[0].documentId).toBe(slip.id);
		expect(merged[0].transactionId).toBe(CREDIT);

		expect(await removeDocument(slip.id, ADMIN, testDb)).toEqual({ ok: true });

		// The payslip's half is gone; what the bank proved is still there, as the
		// credit-only row it was before a slip ever claimed it.
		const after = await rowsFor('2026-07');
		expect(after).toHaveLength(1);
		expect(after[0].documentId).toBeNull();
		expect(after[0].transactionId).toBe(CREDIT);
		expect(after[0].netMinor).toBe(5_231_000n);
		expect(after[0].grossMinor).toBeNull();
		expect(after[0].source).toBe('statement');

		// The ledger is not touched. Deleting paper is not deleting money.
		const [credit] = await testDb.select().from(transaction).where(eq(transaction.id, CREDIT));
		expect(credit).toBeDefined();
		expect(credit.amountMinor).toBe(5_231_000n);

		expect(await testDb.select().from(document).where(eq(document.id, slip.id))).toHaveLength(0);
		expect(await uploadSize(slip.storedName)).toBeNull();
	});

	it('leaves nothing behind when no bank credit was ever merged in', async () => {
		await seedHousehold();
		const slip = await payslip('2026-06', 6_840_000n);

		expect(await removeDocument(slip.id, ADMIN, testDb)).toEqual({ ok: true });

		expect(await rowsFor('2026-06')).toHaveLength(0);
		expect(await testDb.select().from(document).where(eq(document.id, slip.id))).toHaveLength(0);
		expect(await uploadSize(slip.storedName)).toBeNull();
	});

	it('does not collide with the row of the same month that no payslip claimed', async () => {
		// The failure this exists to stop: `salary_entry.document_id` is SET NULL,
		// so deleting the document turned the slip's row into a SECOND unclaimed
		// row for the month — which `salary_entry_person_month_key` refuses, and
		// the screen showed a 500.
		await seedHousehold();
		const slip = await payslip('2026-05', 6_840_000n);
		expect(
			await recordSalary(
				{
					personId: ROBERT,
					periodMonth: '2026-05',
					currency: 'CZK',
					netMinor: 5_000_000n,
					source: 'statement'
				},
				testDb
			)
		).toEqual({ ok: true });
		expect(await rowsFor('2026-05')).toHaveLength(2);

		expect(await removeDocument(slip.id, ADMIN, testDb)).toEqual({ ok: true });

		const after = await rowsFor('2026-05');
		expect(after).toHaveLength(1);
		expect(after[0].documentId).toBeNull();
		expect(after[0].netMinor).toBe(5_000_000n);
	});

	it('is absent, not forbidden, to a member who may not see it', async () => {
		await seedHousehold();
		const slip = await payslip('2026-04', 6_840_000n);
		await testDb
			.update(document)
			.set({ sensitivity: 'restricted' })
			.where(eq(document.id, slip.id));

		expect(await removeDocument(slip.id, MEMBER, testDb)).toEqual({
			ok: false,
			status: 404,
			message: NOT_THERE
		});

		// Nothing moved: not the entry, not the row, not the file.
		expect(await rowsFor('2026-04')).toHaveLength(1);
		expect(await testDb.select().from(document).where(eq(document.id, slip.id))).toHaveLength(1);
		expect(await uploadSize(slip.storedName)).not.toBeNull();
	});

	it('says exactly the same thing about a document that was never there', async () => {
		expect(await removeDocument(rowId('dl-nothing'), ADMIN, testDb)).toEqual({
			ok: false,
			status: 404,
			message: NOT_THERE
		});
	});

	it("still refuses the statement behind an import, in Task 8's words", async () => {
		const { documentId, storedName } = await ingestOneStatement(rowId('dl-import'), 'fio-remove');

		expect(await removeDocument(documentId, ADMIN, testDb)).toEqual({
			ok: false,
			status: 409,
			message: 'This is the statement behind an import; it stays with the import.'
		});

		expect(await testDb.select().from(document).where(eq(document.id, documentId))).toHaveLength(1);
		expect(await uploadSize(storedName)).not.toBeNull();
	});
});

/**
 * The two inspector edits that would orphan a salary entry without saying so.
 *
 * Through the page's own action rather than a hand-written update: the guard
 * has to sit in front of the save the household actually performs, and a test
 * that wrote the columns itself would pass with no guard at all.
 */
describe('editing a payslip that carries a salary entry', () => {
	const asAdmin = {
		person: { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin', theme: null }
	};

	async function save(
		documentId: string,
		fields: { name?: string; type: string; linkIds: string[] }
	): Promise<{ status?: number; data?: { message?: string } }> {
		const { actions } = await import('../../src/routes/(app)/documents/+page.server');
		const form = new FormData();
		form.set('id', documentId);
		form.set('name', fields.name ?? 'Payslip 2026-07 · Robert');
		form.set('type', fields.type);
		for (const value of fields.linkIds) form.append('linkIds', value);
		const request = new Request('http://localhost/documents?/updateDocument', {
			method: 'POST',
			body: form
		});
		return (await (actions.updateDocument as unknown as (event: unknown) => Promise<unknown>)({
			request,
			locals: asAdmin
		})) as { status?: number; data?: { message?: string } };
	}

	it('refuses to retype it as something that is not a payslip', async () => {
		await seedHousehold();
		const slip = await payslip('2026-07', 6_840_000n);

		const outcome = await save(slip.id, { type: 'other', linkIds: [ROBERT] });
		expect(outcome.status).toBe(409);
		expect(outcome.data?.message).toBe(CARRIES_AN_ENTRY);

		const [row] = await testDb.select().from(document).where(eq(document.id, slip.id));
		expect(row.type).toBe('payslip');
	});

	it('refuses to unlink the person the entry belongs to', async () => {
		await seedHousehold();
		const slip = await payslip('2026-07', 6_840_000n);

		const outcome = await save(slip.id, { type: 'payslip', linkIds: [] });
		expect(outcome.status).toBe(409);
		expect(outcome.data?.message).toBe(CARRIES_AN_ENTRY);

		const links = await testDb
			.select()
			.from(documentLink)
			.where(eq(documentLink.documentId, slip.id));
		expect(links.map((link) => link.targetId)).toEqual([ROBERT]);
	});

	it('lets every other edit through — a payslip is still a document', async () => {
		await seedHousehold();
		const slip = await payslip('2026-07', 6_840_000n);

		const outcome = await save(slip.id, {
			name: 'July payslip',
			type: 'payslip',
			linkIds: [ROBERT]
		});
		expect(outcome.status).toBeUndefined();

		const [row] = await testDb.select().from(document).where(eq(document.id, slip.id));
		expect(row.name).toBe('July payslip');
		expect(row.type).toBe('payslip');
	});
});

/**
 * The same guard, reached from the selection bar rather than the inspector.
 *
 * The bulk bar sets one type over everything ticked, and it went straight to
 * the UPDATE — so the retype the inspector refuses could be performed on the
 * same payslip by ticking it in the list, and the salary entry was orphaned
 * with nothing said. A bulk edit is a convenience, though, and refusing the
 * whole thing because one of forty documents is a payslip would be a poor
 * trade: the payslip's type is left alone, everything else is applied, and the
 * result says how many were left as they were.
 */
describe('a bulk edit that would retype a payslip', () => {
	const asAdmin = {
		person: { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin', theme: null }
	};

	async function plainDocument(name: string): Promise<string> {
		const id = rowId(`dl-bulk-${name}`);
		await makeDocument(testDb, {
			id,
			name,
			shelfKey: 'household',
			type: 'other',
			addedOn: '2026-08-25'
		});
		return id;
	}

	async function bulkUpdate(
		ids: string[],
		fields: { type?: string; shelf?: string }
	): Promise<{ ok?: boolean; skipped?: number; message?: string; status?: number }> {
		const { actions } = await import('../../src/routes/(app)/documents/+page.server');
		const form = new FormData();
		for (const id of ids) form.append('ids', id);
		if (fields.type) form.set('type', fields.type);
		if (fields.shelf) form.set('shelf', fields.shelf);
		const request = new Request('http://localhost/documents?/bulkUpdate', {
			method: 'POST',
			body: form
		});
		return (await (actions.bulkUpdate as unknown as (event: unknown) => Promise<unknown>)({
			request,
			locals: asAdmin
		})) as { ok?: boolean; skipped?: number; message?: string; status?: number };
	}

	const typeOf = async (id: string) =>
		(await testDb.select().from(document).where(eq(document.id, id)))[0]?.type;

	it('leaves its type as it is, and says how many it left alone', async () => {
		await seedHousehold();
		const slip = await payslip('2026-07', 6_840_000n);

		const outcome = await bulkUpdate([slip.id], { type: 'other' });

		// Not a failure: nothing the person asked for was impossible, and forty
		// documents must not be refused over one.
		expect(outcome.status).toBeUndefined();
		expect(outcome.ok).toBe(true);
		expect(outcome.skipped).toBe(1);
		expect(outcome.message).toMatch(/salary entry/i);
		expect(await typeOf(slip.id)).toBe('payslip');

		// And the entry it carries is exactly where it was.
		expect(await rowsFor('2026-07')).toHaveLength(1);
	});

	it('retypes everything beside it', async () => {
		await seedHousehold();
		const slip = await payslip('2026-07', 6_840_000n);
		const letter = await plainDocument('Letter');

		const outcome = await bulkUpdate([slip.id, letter], { type: 'correspondence' });

		expect(outcome.skipped).toBe(1);
		expect(await typeOf(letter)).toBe('correspondence');
		expect(await typeOf(slip.id)).toBe('payslip');
	});

	it('says nothing when nothing was left alone', async () => {
		await seedHousehold();
		const letter = await plainDocument('Letter');

		const outcome = await bulkUpdate([letter], { type: 'correspondence' });
		expect(outcome.skipped).toBe(0);
		expect(outcome.message).toBeUndefined();
	});

	it('still applies the rest of the edit to the payslip — only the type is refused', async () => {
		// The shelf, the tags and the links are not what orphans an entry; the
		// tracker reads `type`. Refusing the whole row would be a bigger answer
		// than the question.
		await seedHousehold();
		const slip = await payslip('2026-07', 6_840_000n);

		await bulkUpdate([slip.id], { type: 'other', shelf: 'household' });

		const [row] = await testDb.select().from(document).where(eq(document.id, slip.id));
		expect(row.type).toBe('payslip');
		expect(row.shelfId).toBe(await shelfIdByKey('household', testDb));
	});

	it('still guards the payslip when the posted type is not a real enum value at all', async () => {
		// The guard and the write now read the same normalised value — this pins
		// that reading a nonsense string does not let a payslip through because
		// the raw string happened not to equal 'payslip' literally either way.
		await seedHousehold();
		const slip = await payslip('2026-07', 6_840_000n);
		const letter = await plainDocument('Letter');

		const outcome = await bulkUpdate([slip.id, letter], { type: 'not-a-real-type' });

		expect(outcome.skipped).toBe(1);
		expect(await typeOf(slip.id)).toBe('payslip');
		// The one document with nothing to protect still gets the normalised
		// fallback, same as `updateDocument` gives a lone bad value.
		expect(await typeOf(letter)).toBe('other');
	});

	it('leaves type alone entirely when the bulk edit does not touch it', async () => {
		// Guards against normalising an EMPTY type into the truthy fallback
		// 'other' and retyping everything selected as a side effect of a bulk
		// edit that only meant to move a shelf or add a tag.
		await seedHousehold();
		const letter = rowId('dl-bulk-untouched');
		await makeDocument(testDb, {
			id: letter,
			name: 'Untouched',
			shelfKey: 'household',
			type: 'correspondence',
			addedOn: '2026-08-25'
		});

		await bulkUpdate([letter], { shelf: 'household' });

		expect(await typeOf(letter)).toBe('correspondence');
	});
});
