// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { rowId } from '../row-id';
import { contact, document, documentLink } from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

/**
 * Task 15: the Contacts screen's own `DocumentsCard`, one per contact.
 *
 * The card lives inside the inline edit panel (`ContactForm`), not on the row
 * itself, but the load still carries every contact's documents — the list is
 * already loaded whole (see `contact-fold.test.ts`), so this is one extra pair
 * of queries per row rather than a second round trip when a panel opens.
 */
let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const CONTACT = rowId('cd-contact');
const OTHER_CONTACT = rowId('cd-other-contact');

/** A session as a route loader sees it, wide enough for either role. */
interface Locals {
	person: { id: string; name: string; initials: string; role: 'admin' | 'member'; theme: null };
}

const asAdmin: Locals = {
	person: { id: rowId('cd-admin'), name: 'Admin', initials: 'A', role: 'admin', theme: null }
};
const asMember: Locals = {
	person: { id: rowId('cd-member'), name: 'Member', initials: 'M', role: 'member', theme: null }
};

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('contact-documents', { max: 1 });
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
	await harness.sql`truncate document, contact cascade`;
	await testDb.insert(contact).values([
		{ id: CONTACT, name: 'Jana Nováková' },
		{ id: OTHER_CONTACT, name: 'Petr Svoboda' }
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
		shelfId: await shelfIdByKey('inbox', testDb),
		type: 'other',
		sensitivity: options.sensitivity ?? 'normal',
		storedName: options.storedName ?? null,
		ext: 'PDF',
		addedOn: '2026-01-01'
	});
	return id;
}

async function loadContacts(locals: Locals) {
	const { load } = await import('../../src/routes/(app)/contacts/+page.server');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (await (load as any)({
		url: new URL('http://localhost/contacts'),
		locals
	})) as {
		isAdmin: boolean;
		contacts: {
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
	locals: Locals
) {
	const { actions } = await import('../../src/routes/(app)/contacts/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	const request = new Request(`http://localhost/contacts?/${action}`, {
		method: 'POST',
		body: form
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (actions[action] as any)({ request, locals });
}

describe('the contacts list card', () => {
	it('prefills the inbox shelf and this contact as the target', async () => {
		const { contacts } = await loadContacts(asAdmin);
		const card = contacts.find((c) => c.id === CONTACT);
		expect(card?.addDocumentHref).toBe(
			`/documents?add=1&addShelfKey=inbox&targetKind=contact&targetId=${CONTACT}`
		);
	});

	it('lists a document linked to one contact, and not on another contact’s card', async () => {
		const doc = await seedDocument({ name: 'Signed NDA' });
		await testDb.insert(documentLink).values({ documentId: doc, targetId: CONTACT });

		const { contacts } = await loadContacts(asAdmin);
		expect(contacts.find((c) => c.id === CONTACT)?.documents.map((d) => d.name)).toEqual([
			'Signed NDA'
		]);
		expect(contacts.find((c) => c.id === OTHER_CONTACT)?.documents).toEqual([]);
	});
});

describe('attach and detach through the actions', () => {
	it('attaches an existing document to a contact', async () => {
		const doc = await seedDocument({ name: 'Business card scan' });
		const result = await postAction(
			'attachDocument',
			{ targetId: CONTACT, documentId: doc },
			asAdmin
		);
		expect(result).toEqual({ ok: true });

		const links = await testDb
			.select()
			.from(documentLink)
			.where(eq(documentLink.targetId, CONTACT));
		expect(links.map((l) => l.documentId)).toEqual([doc]);

		const { contacts } = await loadContacts(asAdmin);
		const card = contacts.find((c) => c.id === CONTACT);
		expect(card?.documents.map((d) => d.id)).toEqual([doc]);
		// Attached, so it is no longer offered a second time.
		expect(card?.documentCandidates.some((c) => c.id === doc)).toBe(false);
	});

	it('detaches the link only — the document stays on its shelf', async () => {
		const doc = await seedDocument({ name: 'Referral letter' });
		await testDb.insert(documentLink).values({ documentId: doc, targetId: CONTACT });

		const result = await postAction(
			'detachDocument',
			{ targetId: CONTACT, documentId: doc },
			asAdmin
		);
		expect(result).toEqual({ ok: true });

		const links = await testDb
			.select()
			.from(documentLink)
			.where(eq(documentLink.targetId, CONTACT));
		expect(links).toEqual([]);

		const [row] = await testDb.select().from(document).where(eq(document.id, doc));
		expect(row).toBeDefined();
	});

	it('refuses to attach a restricted document for a member, and does not link it', async () => {
		const doc = await seedDocument({ name: 'Divorce papers', sensitivity: 'restricted' });
		const result: unknown = await postAction(
			'attachDocument',
			{ targetId: CONTACT, documentId: doc },
			asMember
		);
		expect(result).toMatchObject({ status: 404 });
		const links = await testDb
			.select()
			.from(documentLink)
			.where(eq(documentLink.targetId, CONTACT));
		expect(links).toEqual([]);
	});

	it('shows a restricted document on an admin’s card but hides it from a member', async () => {
		const doc = await seedDocument({ name: 'Sensitive letter', sensitivity: 'restricted' });
		await testDb.insert(documentLink).values({ documentId: doc, targetId: CONTACT });

		const { contacts: adminContacts } = await loadContacts(asAdmin);
		expect(adminContacts.find((c) => c.id === CONTACT)?.documents.map((d) => d.id)).toEqual([doc]);

		const { contacts: memberContacts } = await loadContacts(asMember);
		expect(memberContacts.find((c) => c.id === CONTACT)?.documents).toEqual([]);
	});
});
