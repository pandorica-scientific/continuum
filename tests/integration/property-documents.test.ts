// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { rowId } from '../row-id';
import { document, documentLink, propertyBill, tenancy } from '$lib/server/db/schema';

import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { asAdmin, asMember, makeDocument, makeProperty, type SessionLocals } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * Task 12: the property page's own `DocumentsCard` and the one per tenancy.
 *
 * Both cards read `documentsAbout` against a different target id — the flat's
 * or the tenancy's — so what is asserted here is the split itself: a lease
 * filed against the TENANCY must not appear on the flat's card, and a deed
 * filed against the FLAT must not appear on the tenancy's. The attach/detach
 * actions are exercised through the real route, because the registry lookup
 * inside `attachDocument`/`detachDocument` (which entity kind is `targetId`)
 * is the part a hand-written insert would not cover.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const PROPERTY = rowId('pd-property');
const TENANCY = rowId('pd-tenancy');

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('property-documents', { max: 1 });
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
	await harness.sql`truncate document, property_bill, tenancy, property cascade`;
	await makeProperty(testDb, { id: PROPERTY, name: 'Flat', kind: 'rented', currency: 'CZK' });
	await testDb.insert(tenancy).values({
		id: TENANCY,
		propertyId: PROPERTY,
		tenantName: 'Petr Nájemník',
		startsOn: '2024-01-01',
		endsOn: null
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
		shelfKey: 'inventory',
		type: 'other',
		sensitivity: options.sensitivity ?? 'normal',
		storedName: options.storedName ?? null,
		ext: 'PDF',
		addedOn: '2026-01-01'
	});
	return id;
}

async function loadProperty(locals: SessionLocals) {
	const { load } = await import('../../src/routes/(app)/property/+page.server');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (await (load as any)({
		url: new URL('http://localhost/property'),
		locals
	})) as {
		detail: {
			documents: { id: string; name: string }[];
			documentCandidates: { id: string; name: string }[];
			addDocumentHref: string;
			bills: { id: string; documentId: string | null }[];
			lease: {
				id: string;
				documents: { id: string; name: string }[];
				documentCandidates: { id: string; name: string }[];
				addDocumentHref: string;
			} | null;
		} | null;
	};
}

async function postAction(
	action: 'attachDocument' | 'detachDocument',
	fields: Record<string, string>,
	locals: SessionLocals
) {
	const { actions } = await import('../../src/routes/(app)/property/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	const request = new Request(`http://localhost/property?/${action}`, {
		method: 'POST',
		body: form
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (actions[action] as any)({ request, locals });
}

describe('the flat card and its tenancy card', () => {
	it('prefills the flat card at the property target and the tenancy card at the tenancy target', async () => {
		const { detail } = await loadProperty(asAdmin);
		expect(detail?.addDocumentHref).toBe(
			`/documents?add=1&addShelfKey=property&targetKind=property&targetId=${PROPERTY}`
		);
		expect(detail?.lease?.addDocumentHref).toBe(
			`/documents?add=1&addShelfKey=tenancy&targetKind=tenancy&targetId=${TENANCY}`
		);
	});

	it('lists a document linked to the tenancy on the tenancy card, and not on the flat card', async () => {
		const lease = await seedDocument({ name: 'Signed lease' });
		await testDb.insert(documentLink).values({ documentId: lease, targetId: TENANCY });

		const { detail } = await loadProperty(asAdmin);
		expect(detail?.lease?.documents.map((d) => d.name)).toEqual(['Signed lease']);
		expect(detail?.documents.map((d) => d.name)).toEqual([]);
	});

	it('lists a document linked to the flat on the flat card, and not on the tenancy card', async () => {
		const deed = await seedDocument({ name: 'Title deed' });
		await testDb.insert(documentLink).values({ documentId: deed, targetId: PROPERTY });

		const { detail } = await loadProperty(asAdmin);
		expect(detail?.documents.map((d) => d.name)).toEqual(['Title deed']);
		expect(detail?.lease?.documents.map((d) => d.name)).toEqual([]);
	});
});

describe('attach and detach through the actions', () => {
	it('attaches an existing document to the flat', async () => {
		const doc = await seedDocument({ name: 'Insurance policy' });
		const result = await postAction(
			'attachDocument',
			{ targetId: PROPERTY, documentId: doc },
			asAdmin
		);
		expect(result).toEqual({ ok: true });

		const links = await testDb
			.select()
			.from(documentLink)
			.where(eq(documentLink.targetId, PROPERTY));
		expect(links.map((l) => l.documentId)).toEqual([doc]);

		const { detail } = await loadProperty(asAdmin);
		expect(detail?.documents.map((d) => d.id)).toEqual([doc]);
		// Attached, so it is no longer offered a second time.
		expect(detail?.documentCandidates.some((c) => c.id === doc)).toBe(false);
	});

	it('attaches an existing document to a tenancy', async () => {
		const doc = await seedDocument({ name: 'Signed lease' });
		const result = await postAction(
			'attachDocument',
			{ targetId: TENANCY, documentId: doc },
			asAdmin
		);
		expect(result).toEqual({ ok: true });

		const { detail } = await loadProperty(asAdmin);
		expect(detail?.lease?.documents.map((d) => d.id)).toEqual([doc]);
	});

	it('detaches the link only — the document stays on its shelf', async () => {
		const doc = await seedDocument({ name: 'Insurance policy' });
		await testDb.insert(documentLink).values({ documentId: doc, targetId: PROPERTY });

		const result = await postAction(
			'detachDocument',
			{ targetId: PROPERTY, documentId: doc },
			asAdmin
		);
		expect(result).toEqual({ ok: true });

		const links = await testDb
			.select()
			.from(documentLink)
			.where(eq(documentLink.targetId, PROPERTY));
		expect(links).toEqual([]);

		const [row] = await testDb.select().from(document).where(eq(document.id, doc));
		expect(row).toBeDefined();
	});

	it('refuses to attach a restricted document for a member, and does not link it', async () => {
		const doc = await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted' });
		const result: unknown = await postAction(
			'attachDocument',
			{ targetId: PROPERTY, documentId: doc },
			asMember
		);
		expect(result).toMatchObject({ status: 404 });
		const links = await testDb
			.select()
			.from(documentLink)
			.where(eq(documentLink.targetId, PROPERTY));
		expect(links).toEqual([]);
	});
});

describe('a bill’s paperclip', () => {
	async function seedBill(sensitivity: 'normal' | 'restricted') {
		const doc = await seedDocument({
			name: 'Electricity bill',
			sensitivity,
			storedName: 'bill.pdf'
		});
		await testDb.insert(documentLink).values({ documentId: doc, targetId: PROPERTY });
		await testDb.insert(propertyBill).values({
			id: rowId('pd-bill'),
			propertyId: PROPERTY,
			label: 'Electricity',
			amountMinor: 1_00n,
			documentId: doc
		});
		return doc;
	}

	it('gives an admin the documentId behind a normal bill', async () => {
		const doc = await seedBill('normal');
		const { detail } = await loadProperty(asAdmin);
		expect(detail?.bills[0].documentId).toBe(doc);
	});

	it('gives a member null for a restricted bill, never the raw column', async () => {
		await seedBill('restricted');
		const { detail } = await loadProperty(asMember);
		expect(detail?.bills[0].documentId).toBeNull();
	});

	it('gives an admin the documentId behind a restricted bill', async () => {
		const doc = await seedBill('restricted');
		const { detail } = await loadProperty(asAdmin);
		expect(detail?.bills[0].documentId).toBe(doc);
	});
});
