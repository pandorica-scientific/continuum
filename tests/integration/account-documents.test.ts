// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { rowId } from '../row-id';
import { account, document, documentLink } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * Task 14: the Accounts screen's own `DocumentsCard`, one per account.
 *
 * There is no upload control on this card — imports and the Investments
 * upload own creation — so the first case here runs a real Fio CSV through
 * `ingestFile` (the fixture shape `import-integrity.test.ts` uses) and checks
 * the statement it files lands on the RIGHT account's card. The rest exercise
 * attach/detach exactly like the other two document-card suites.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;
let previousUploadDir: string | undefined;

const ACCOUNT = rowId('ad-account');
const OTHER_ACCOUNT = rowId('ad-other-account');

/** A session as a route loader sees it, wide enough for either role. */
interface Locals {
	person: { id: string; name: string; initials: string; role: 'admin' | 'member'; theme: null };
}

const asAdmin: Locals = {
	person: { id: rowId('ad-admin'), name: 'Admin', initials: 'A', role: 'admin', theme: null }
};
const asMember: Locals = {
	person: { id: rowId('ad-member'), name: 'Member', initials: 'M', role: 'member', theme: null }
};

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	previousUploadDir = process.env.UPLOAD_DIR;
	harness = await startPostgres('account-documents', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	process.env.UPLOAD_DIR = resolve('scratch-workspace/account-documents-uploads');
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
	if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
	else process.env.UPLOAD_DIR = previousUploadDir;
});

beforeEach(async () => {
	await harness.sql`truncate document, transaction, import_file, account cascade`;
	await testDb.insert(account).values([
		{ id: ACCOUNT, name: 'Fio joint', bank: 'fio', currency: 'CZK', numbers: [] },
		{ id: OTHER_ACCOUNT, name: 'Savings', bank: 'fio', currency: 'CZK', numbers: [] }
	]);
});

async function seedDocument(options: {
	name: string;
	sensitivity?: 'normal' | 'restricted';
	storedName?: string | null;
}): Promise<string> {
	const id = uuidv7();
	await testDb.insert(document).values({
		id,
		name: options.name,
		shelfId: await shelfIdByKey('statements', testDb),
		type: 'bank_statement',
		sensitivity: options.sensitivity ?? 'normal',
		storedName: options.storedName ?? null,
		ext: 'PDF',
		addedOn: '2026-01-01'
	});
	return id;
}

async function loadAccounts(locals: Locals) {
	const { load } = await import('../../src/routes/(app)/accounts/+page.server');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (await (load as any)({ locals })) as {
		isAdmin: boolean;
		accounts: {
			id: string;
			documents: { id: string; name: string }[];
			documentCandidates: { id: string; name: string }[];
		}[];
	};
}

async function postAction(
	action: 'attachDocument' | 'detachDocument',
	fields: Record<string, string>,
	locals: Locals
) {
	const { actions } = await import('../../src/routes/(app)/accounts/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	const request = new Request(`http://localhost/accounts?/${action}`, {
		method: 'POST',
		body: form
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (actions[action] as any)({ request, locals });
}

/** Same shape `import-integrity.test.ts` builds a Fio export from. */
function fioStatement({
	accountNumber,
	bookedOn,
	amount,
	counterpartyAccount,
	bankRef
}: {
	accountNumber: string;
	bookedOn: string;
	amount: string;
	counterpartyAccount: string;
	bankRef: string;
}): Uint8Array {
	const [year, month, day] = bookedOn.split('-');
	const czDay = `${day}.${month}.${year}`;
	const [counterpartyNumber, counterpartyBank] = counterpartyAccount.split('/');
	const closing = Number(amount.replace(',', '.'));
	const czClosing = closing.toFixed(2).replace('.', ',');
	return new TextEncoder().encode(
		[
			`"Výpis č. 1/${year} z účtu ""${accountNumber}"""`,
			`"Období: ${czDay} - ${czDay}"`,
			`"Počáteční stav účtu k ${czDay}: 0,00 CZK"`,
			`"Koncový stav účtu k ${czDay}: ${czClosing} CZK"`,
			'',
			'"ID operace";"Datum";"Objem";"Měna";"Protiúčet";"Název protiúčtu";"Kód banky";"Název banky";"KS";"VS";"SS";"Poznámka";"Zpráva pro příjemce";"Typ"',
			`"${bankRef}";"${czDay}";"${amount}";"CZK";"${counterpartyNumber}";"";"${counterpartyBank}";"";"";"";"";"";"";"Bezhotovostní platba"`
		].join('\n')
	);
}

describe('a statement filed by ingest', () => {
	it('appears on its own account’s card, and not on another account’s', async () => {
		const { ingestFile } = await import('$lib/server/import/ingest');
		const csv = fioStatement({
			accountNumber: '2600123456/2010',
			bookedOn: '2026-07-15',
			amount: '1500,00',
			counterpartyAccount: '9999999999/0800',
			bankRef: 'op-1'
		});
		const result = await ingestFile('statement.csv', csv, ACCOUNT, testDb);
		expect(result.error).toBeUndefined();

		const { accounts } = await loadAccounts(asAdmin);
		const card = accounts.find((a) => a.id === ACCOUNT);
		expect(card?.documents).toHaveLength(1);
		// `statementDocumentName` already bakes the bank and the period into the
		// name, which is why the card's meta line does not need to repeat them.
		expect(card?.documents[0].name).toContain('Fio');

		expect(accounts.find((a) => a.id === OTHER_ACCOUNT)?.documents).toEqual([]);
	});
});

describe('attach and detach through the actions', () => {
	it('attaches an existing document to an account', async () => {
		const doc = await seedDocument({ name: 'Broker report Q2' });
		const result = await postAction(
			'attachDocument',
			{ targetId: ACCOUNT, documentId: doc },
			asAdmin
		);
		expect(result).toEqual({ ok: true });

		const links = await testDb
			.select()
			.from(documentLink)
			.where(eq(documentLink.targetId, ACCOUNT));
		expect(links.map((l) => l.documentId)).toEqual([doc]);

		const { accounts } = await loadAccounts(asAdmin);
		expect(accounts.find((a) => a.id === ACCOUNT)?.documents.map((d) => d.id)).toEqual([doc]);
	});

	it('detaches the link only — the document stays on its shelf', async () => {
		const doc = await seedDocument({ name: 'March statement' });
		await testDb.insert(documentLink).values({ documentId: doc, targetId: ACCOUNT });

		const result = await postAction(
			'detachDocument',
			{ targetId: ACCOUNT, documentId: doc },
			asAdmin
		);
		expect(result).toEqual({ ok: true });

		const links = await testDb
			.select()
			.from(documentLink)
			.where(eq(documentLink.targetId, ACCOUNT));
		expect(links).toEqual([]);

		const [row] = await testDb.select().from(document).where(eq(document.id, doc));
		expect(row).toBeDefined();
	});

	it('refuses to attach a restricted document for a member, and does not link it', async () => {
		const doc = await seedDocument({
			name: 'Private brokerage statement',
			sensitivity: 'restricted'
		});
		const result: unknown = await postAction(
			'attachDocument',
			{ targetId: ACCOUNT, documentId: doc },
			asMember
		);
		expect(result).toMatchObject({ status: 404 });
		const links = await testDb
			.select()
			.from(documentLink)
			.where(eq(documentLink.targetId, ACCOUNT));
		expect(links).toEqual([]);
	});

	it('shows a restricted document on an admin’s card but hides it from a member', async () => {
		const doc = await seedDocument({ name: 'Sensitive statement', sensitivity: 'restricted' });
		await testDb.insert(documentLink).values({ documentId: doc, targetId: ACCOUNT });

		const { accounts: adminAccounts } = await loadAccounts(asAdmin);
		expect(adminAccounts.find((a) => a.id === ACCOUNT)?.documents.map((d) => d.id)).toEqual([doc]);

		const { accounts: memberAccounts } = await loadAccounts(asMember);
		expect(memberAccounts.find((a) => a.id === ACCOUNT)?.documents).toEqual([]);
	});
});
