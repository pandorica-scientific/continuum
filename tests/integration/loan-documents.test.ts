// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { rowId } from '../row-id';
import { document, documentLink } from '$lib/server/db/schema';

import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { asAdmin, asMember, makeDocument, makeLoan, type SessionLocals } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * Task 13: the Loans screen's own `DocumentsCard`, one per loan.
 *
 * The screen shows every loan at once, so what matters here is the split: a
 * document filed against ONE loan must not appear on another loan's card even
 * though both cards are rendered from the same load. Attach/detach run
 * through the real actions, because the registry lookup inside
 * `attachDocument`/`detachDocument` — is `targetId` actually a loan — is the
 * part a hand-written insert would not cover.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const LOAN = rowId('ld-loan');
const OTHER_LOAN = rowId('ld-other-loan');

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('loan-documents', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`truncate document, loan cascade`;
	await makeLoan(testDb, {
		id: LOAN,
		name: 'Mortgage · Karlín',
		principalMinor: 5_000_000_00n,
		owedMinor: 4_000_000_00n
	});
	await makeLoan(testDb, {
		id: OTHER_LOAN,
		name: 'Car loan',
		principalMinor: 300_000_00n,
		owedMinor: 100_000_00n
	});
});

async function seedDocument(options: {
	name: string;
	sensitivity?: 'normal' | 'restricted';
	storedName?: string | null;
}): Promise<string> {
	const id = uuidv7();
	await makeDocument(testDb, {
		id,
		name: options.name,
		shelfKey: 'finance',
		type: 'other',
		sensitivity: options.sensitivity ?? 'normal',
		storedName: options.storedName ?? null,
		ext: 'PDF',
		addedOn: '2026-01-01'
	});
	return id;
}

async function loadLoans(locals: SessionLocals) {
	const { load } = await import('../../src/routes/(app)/loans/+page.server');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (await (load as any)({
		url: new URL('http://localhost/loans'),
		locals
	})) as {
		isAdmin: boolean;
		loans: {
			id: string;
			documents: { id: string; name: string }[];
			documentCandidates: { id: string; name: string }[];
			addDocumentHref: string;
		}[];
	};
}

async function postAction(
	action: 'attachDocument' | 'detachDocument',
	fields: Record<string, string>,
	locals: SessionLocals
) {
	const { actions } = await import('../../src/routes/(app)/loans/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	const request = new Request(`http://localhost/loans?/${action}`, {
		method: 'POST',
		body: form
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (actions[action] as any)({ request, locals });
}

describe('the loans list card', () => {
	it('prefills the finance shelf and this loan as the target', async () => {
		const { loans } = await loadLoans(asAdmin);
		const card = loans.find((l) => l.id === LOAN);
		expect(card?.addDocumentHref).toBe(
			`/documents?add=1&addShelfKey=finance&targetKind=loan&targetId=${LOAN}`
		);
	});

	it('lists a document linked to one loan, and not on a different loan’s card', async () => {
		const doc = await seedDocument({ name: 'Mortgage agreement' });
		await testDb.insert(documentLink).values({ documentId: doc, targetId: LOAN });

		const { loans } = await loadLoans(asAdmin);
		expect(loans.find((l) => l.id === LOAN)?.documents.map((d) => d.name)).toEqual([
			'Mortgage agreement'
		]);
		expect(loans.find((l) => l.id === OTHER_LOAN)?.documents).toEqual([]);
	});
});

describe('attach and detach through the actions', () => {
	it('attaches an existing document to a loan', async () => {
		const doc = await seedDocument({ name: 'Re-fix letter' });
		const result = await postAction('attachDocument', { targetId: LOAN, documentId: doc }, asAdmin);
		expect(result).toEqual({ ok: true });

		const links = await testDb.select().from(documentLink).where(eq(documentLink.targetId, LOAN));
		expect(links.map((l) => l.documentId)).toEqual([doc]);

		const { loans } = await loadLoans(asAdmin);
		const card = loans.find((l) => l.id === LOAN);
		expect(card?.documents.map((d) => d.id)).toEqual([doc]);
		// Attached, so it is no longer offered a second time.
		expect(card?.documentCandidates.some((c) => c.id === doc)).toBe(false);
	});

	it('detaches the link only — the document stays on its shelf', async () => {
		const doc = await seedDocument({ name: 'Insurance policy' });
		await testDb.insert(documentLink).values({ documentId: doc, targetId: LOAN });

		const result = await postAction('detachDocument', { targetId: LOAN, documentId: doc }, asAdmin);
		expect(result).toEqual({ ok: true });

		const links = await testDb.select().from(documentLink).where(eq(documentLink.targetId, LOAN));
		expect(links).toEqual([]);

		const [row] = await testDb.select().from(document).where(eq(document.id, doc));
		expect(row).toBeDefined();
	});

	it('refuses to attach a restricted document for a member, and does not link it', async () => {
		const doc = await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted' });
		const result: unknown = await postAction(
			'attachDocument',
			{ targetId: LOAN, documentId: doc },
			asMember
		);
		expect(result).toMatchObject({ status: 404 });
		const links = await testDb.select().from(documentLink).where(eq(documentLink.targetId, LOAN));
		expect(links).toEqual([]);
	});

	it('shows a restricted document on an admin’s card but hides it from a member', async () => {
		const doc = await seedDocument({ name: 'Sensitive rider', sensitivity: 'restricted' });
		await testDb.insert(documentLink).values({ documentId: doc, targetId: LOAN });

		const { loans: adminLoans } = await loadLoans(asAdmin);
		expect(adminLoans.find((l) => l.id === LOAN)?.documents.map((d) => d.id)).toEqual([doc]);

		const { loans: memberLoans } = await loadLoans(asMember);
		expect(memberLoans.find((l) => l.id === LOAN)?.documents).toEqual([]);
	});
});
