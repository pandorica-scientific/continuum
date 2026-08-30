// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { eq } from 'drizzle-orm';
import { documentLink, entity, subject } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeDocument, makeLoan, makePerson, makeTransaction } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * The last read path, and the one where the leak would be a number.
 *
 * A member seeing "27" beside a shelf holding the 26 documents they can open
 * has been told something exists. That is why the counts are computed in SQL
 * behind the same predicate as the rows, rather than by counting the array
 * afterwards.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const asAdmin = { person: { id: 'a', name: 'A', initials: 'A', role: 'admin', theme: null } };
const asMember = { person: { id: 'm', name: 'M', initials: 'M', role: 'member', theme: null } };

/**
 * One record of every kind the screen has to be able to offer or name.
 *
 * A loan and a transaction above all: the loan is pickable and the transaction
 * is not, and the two halves of this task are that both are still OFFERED by
 * the about filter while only one of them is offered by a picker.
 */
const RECORD = {
	person: uuidv7(),
	account: uuidv7(),
	transaction: uuidv7(),
	loan: uuidv7()
} as const;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('documents-load', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;

	await makePerson(testDb, { id: RECORD.person, name: 'Robert', initials: 'R', role: 'admin' });
	await makeAccount(testDb, {
		id: RECORD.account,
		name: 'Fio current',
		bank: 'fio',
		kind: 'current',
		currency: 'CZK'
	});
	await makeTransaction(testDb, {
		id: RECORD.transaction,
		accountId: RECORD.account,
		bookedOn: '2026-03-04',
		amountMinor: -123_450n,
		currency: 'CZK',
		counterparty: 'Alza',
		dedupFingerprint: 'documents-load-alza'
	});
	await makeLoan(testDb, {
		id: RECORD.loan,
		name: 'Vinohrady mortgage',
		currency: 'CZK',
		principalMinor: 500_000_000n,
		owedMinor: 400_000_000n
	});
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`delete from document`;
});

async function seedShelf(key: string, counts: { normal: number; restricted: number }) {
	const shelfId = await shelfIdByKey(key, testDb);
	for (const [sensitivity, n] of [
		['normal', counts.normal],
		['restricted', counts.restricted]
	] as const) {
		for (let i = 0; i < n; i++) {
			await makeDocument(testDb, {
				id: uuidv7(),
				name: `${sensitivity} ${i}`,
				shelfId,
				type: 'other',
				sensitivity,
				addedOn: '2026-01-01'
			});
		}
	}
}

interface AboutOption {
	id: string;
	name: string;
	meta?: string;
	kind: string;
	groupLabel: string;
	count: number;
}

type LoadedDocuments = {
	shelves: { key: string; label: string; count: number }[];
	total: number;
	filterOptions: { entities: AboutOption[] };
	pickableTargets: { id: string; kind: string; groupLabel: string }[];
};

async function loadDocuments(locals: unknown): Promise<LoadedDocuments> {
	const { load } = await import('../../src/routes/(app)/documents/+page.server');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (await (load as any)({
		url: new URL('http://localhost/documents'),
		locals
	})) as LoadedDocuments;
}

describe('the documents load', () => {
	it('gives a member a rail count that has already forgotten the restricted one', async () => {
		await seedShelf('household', { normal: 26, restricted: 1 });
		const data = await loadDocuments(asMember);
		expect(data.shelves.find((s) => s.key === 'household')!.count).toBe(26);
		expect(data.shelves.find((s) => s.key === 'all')!.count).toBe(26);
		expect(data.total).toBe(26);
	});

	it('gives the admin 27', async () => {
		await seedShelf('household', { normal: 26, restricted: 1 });
		const data = await loadDocuments(asAdmin);
		expect(data.shelves.find((s) => s.key === 'household')!.count).toBe(27);
		expect(data.total).toBe(27);
	});

	it('never shows a teaser row', async () => {
		// Not a row, not a name, not a flag set on anything the member can see.
		// The document does not reach the screen at all — there is nothing to
		// dim, grey out or mark as withheld, because a placeholder IS the leak.
		await seedShelf('household', { normal: 1, restricted: 1 });
		const data = (await loadDocuments(asMember)) as LoadedDocuments & {
			rows: { name: string; restricted: boolean }[];
		};
		expect(data.rows).toHaveLength(1);
		expect(data.rows.every((r) => r.restricted === false)).toBe(true);
		expect(JSON.stringify(data.rows)).not.toMatch(/restricted 0/);
	});
});

/**
 * A document filed against a loan and against a transaction, which is what the
 * about filter and the capture form each have to cope with: one kind a picker
 * may offer, one kind it may not.
 */
async function fileAgainst(name: string, targetIds: readonly string[]): Promise<string> {
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name,
		shelfKey: 'household',
		type: 'other',
		addedOn: '2026-01-01'
	});
	for (const targetId of targetIds) {
		await testDb.insert(documentLink).values({ documentId: id, targetId });
	}
	return id;
}

describe('the about filter', () => {
	it('offers every kind the paper points at, under the heading it belongs to', async () => {
		// A loan and a transaction, neither of which the four-kind list the screen
		// used to keep could name — so neither could be filtered by.
		await fileAgainst('Yearly mortgage statement', [RECORD.loan, RECORD.person]);
		await fileAgainst('Alza receipt', [RECORD.transaction]);

		const { entities } = (await loadDocuments(asAdmin)).filterOptions;
		const byKind = new Map(entities.map((e) => [e.kind, e]));

		expect(byKind.get('loan')?.name).toBe('Vinohrady mortgage');
		expect(byKind.get('loan')?.groupLabel).toBe('Loans');
		expect(byKind.get('loan')?.count).toBe(1);

		// A transaction is not pickable and is still filterable: a receipt is
		// found on the Documents screen exactly as often as anywhere else.
		expect(byKind.get('transaction')?.groupLabel).toBe('Transactions');
		// The name of a card payment is a shop and a date; the amount is what
		// tells two of them apart, in the currency's own symbol.
		expect(byKind.get('transaction')?.meta).toMatch(/1.234[.,]50\sKč/u);

		expect(byKind.get('person')?.groupLabel).toBe('People');
	});

	it('never offers a record nothing on the shelf points at', async () => {
		await fileAgainst('Alza receipt', [RECORD.transaction]);
		const { entities } = (await loadDocuments(asAdmin)).filterOptions;
		expect(entities.some((e) => e.id === RECORD.loan)).toBe(false);
	});
});

describe('capture', () => {
	async function capture(fields: {
		name: string;
		linkIds?: readonly string[];
		newSubject?: string;
	}): Promise<{ addedIds: string[] }> {
		const { actions } = await import('../../src/routes/(app)/documents/+page.server');
		const form = new FormData();
		form.set('name', fields.name);
		form.set('shelf', 'household');
		for (const id of fields.linkIds ?? []) form.append('linkIds', id);
		if (fields.newSubject) form.set('newSubject', fields.newSubject);
		const request = new Request('http://localhost/documents?/addDocument', {
			method: 'POST',
			body: form
		});
		return (await (actions.addDocument as unknown as (event: unknown) => Promise<unknown>)({
			request,
			locals: asAdmin
		})) as { addedIds: string[] };
	}

	it('files the new document against every kind the form posted', async () => {
		// One field, several kinds. The per-kind inputs the action used to read —
		// personIds, propertyIds, accountIds, subjectIds — could not carry a loan
		// at all, because no screen ever wrote a `loanIds` input.
		const { addedIds } = await capture({
			name: 'Mortgage statement',
			linkIds: [RECORD.person, RECORD.loan, RECORD.transaction]
		});
		expect(addedIds).toHaveLength(1);

		const links = await testDb
			.select({ targetId: documentLink.targetId })
			.from(documentLink)
			.where(eq(documentLink.documentId, addedIds[0]));
		expect(links.map((l) => l.targetId).sort()).toEqual(
			[RECORD.person, RECORD.loan, RECORD.transaction].sort()
		);
	});

	it('still mints a subject typed into the form beside the ids that were ticked', async () => {
		const { addedIds } = await capture({
			name: 'Boiler warranty',
			linkIds: [RECORD.person],
			newSubject: 'The boiler'
		});

		const links = await testDb
			.select({ targetId: documentLink.targetId, kind: entity.kind })
			.from(documentLink)
			.innerJoin(entity, eq(entity.id, documentLink.targetId))
			.where(eq(documentLink.documentId, addedIds[0]));
		expect(links.map((l) => l.kind).sort()).toEqual(['person', 'subject']);

		const minted = links.find((l) => l.kind === 'subject')!.targetId;
		const [row] = await testDb.select().from(subject).where(eq(subject.id, minted));
		expect(row.name).toBe('The boiler');
	});

	it('fails plainly, rather than throwing, when a posted file cannot be read', async () => {
		// A real multipart round trip through `Request` reconstructs its own File,
		// so this drives the action directly with a fake `request.formData()` —
		// the only thing the action calls on it — carrying a File whose
		// `arrayBuffer()` is broken, the way a truncated upload can be.
		const { actions } = await import('../../src/routes/(app)/documents/+page.server');
		const file = new File(['broken'], 'broken.pdf', { type: 'application/pdf' });
		file.arrayBuffer = () => Promise.reject(new Error('Corrupt upload.'));
		const form = new FormData();
		form.set('shelf', 'household');
		form.set('file', file);
		const request = { formData: async () => form } as unknown as Request;

		const result = await (actions.addDocument as unknown as (event: unknown) => Promise<unknown>)({
			request,
			locals: asAdmin
		});

		expect(result).toMatchObject({ status: 400, data: { message: 'Corrupt upload.' } });
	});
});

describe('the review screen', () => {
	it('offers every kind a document may be filed against, and no kind it may not', async () => {
		const { load } = await import('../../src/routes/(app)/documents/review/+page.server');
		const data = (await (load as unknown as (event: unknown) => Promise<unknown>)({
			locals: asAdmin
		})) as { targets: { id: string; kind: string; groupLabel: string }[] };

		expect(data.targets.find((t) => t.id === RECORD.loan)?.groupLabel).toBe('Loans');
		expect(data.targets.some((t) => t.id === RECORD.account)).toBe(true);
		// A list of every transaction is a list nobody can read by eye. They reach
		// a document from their own screen instead.
		expect(data.targets.some((t) => t.kind === 'transaction')).toBe(false);
	});
});
