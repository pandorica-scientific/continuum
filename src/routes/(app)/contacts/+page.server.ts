// SPDX-License-Identifier: AGPL-3.0-or-later
import { asRowId } from '$lib/ids';
import { uuidv7 } from 'uuidv7';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { account, loan, property, tenancy } from '$lib/server/db/schema';
import { removeUpload, saveUpload } from '$lib/server/system/files';
import {
	createContact,
	deleteContact,
	emptyLinks,
	isAllowedAvatar,
	listContacts,
	loadContactLinks,
	replaceContactLinks,
	updateContact,
	type ContactInput,
	type ContactLinks
} from '$lib/server/contacts';
import {
	attachDocument,
	candidateDocumentsFor,
	detachDocument,
	documentsAbout
} from '$lib/server/documents/targets';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('q') ?? '';

	const [contacts, links, tenancies, properties, loans, accounts] = await Promise.all([
		listContacts(query),
		loadContactLinks(),
		db
			.select({ id: tenancy.id, name: tenancy.tenantName, propertyId: tenancy.propertyId })
			.from(tenancy)
			.orderBy(tenancy.tenantName),
		db.select({ id: property.id, name: property.name }).from(property).orderBy(property.name),
		db.select({ id: loan.id, name: loan.name }).from(loan).orderBy(loan.name),
		db.select({ id: account.id, name: account.name }).from(account).orderBy(account.name)
	]);

	// `documentsAbout` is one query per contact, run concurrently. `candidateDocumentsFor`
	// is one query for the whole library plus one for links, not refetched per contact's picker.
	const contactIds = contacts.map((c) => c.id);
	const [documentsByContactId, candidatesByContactId] = await Promise.all([
		Promise.all(contactIds.map(async (id) => [id, await documentsAbout(id)] as const)).then(
			(pairs) => new Map(pairs)
		),
		candidateDocumentsFor(contactIds)
	]);

	return {
		query,
		contacts: contacts.map((row) => ({
			...row,
			links: links.get(row.id) ?? emptyLinks(),
			documents: documentsByContactId.get(row.id) ?? [],
			documentCandidates: candidatesByContactId.get(row.id) ?? [],
			addDocumentHref: `/documents?add=1&addShelfKey=inbox&targetKind=contact&targetId=${row.id}`
		})),
		options: { tenancies, properties, loans, accounts }
	};
};

function readFields(form: FormData): Omit<ContactInput, 'photo'> {
	const text = (key: string) => {
		const value = form.get(key);
		return typeof value === 'string' ? value : '';
	};
	return {
		name: text('name'),
		organisation: text('organisation'),
		jobTitle: text('jobTitle'),
		phone: text('phone'),
		email: text('email'),
		address: text('address'),
		notes: text('notes'),
		category: text('category')
	};
}

function readLinks(form: FormData): ContactLinks {
	const ids = (key: string) => form.getAll(key).filter((v): v is string => typeof v === 'string');
	return {
		tenancyIds: ids('tenancyIds'),
		propertyIds: ids('propertyIds'),
		loanIds: ids('loanIds'),
		accountIds: ids('accountIds')
	};
}

/**
 * Store the uploaded avatar, if one came with this submission.
 *
 * Returns the previously stored name when no new file arrived, so an edit that
 * only changes a phone number keeps its photo instead of silently clearing it.
 */
async function readPhoto(
	form: FormData
): Promise<{ ok: true; photo: string | null } | { ok: false; message: string }> {
	const existing = form.get('existingPhoto');
	const keep = typeof existing === 'string' && existing !== '' ? existing : null;

	if (form.get('clearPhoto') === '1') return { ok: true, photo: null };

	const file = form.get('photo');
	if (!(file instanceof File) || file.size === 0) return { ok: true, photo: keep };

	if (!isAllowedAvatar(file.name)) {
		return { ok: false, message: 'A photo must be a PNG, JPEG or WebP image.' };
	}
	return { ok: true, photo: await saveUpload(file) };
}

export const actions: Actions = {
	save: async ({ request }) => {
		const form = await request.formData();
		const id =
			typeof form.get('id') === 'string' && form.get('id') ? asRowId(form.get('id')) : null;
		const fields = readFields(form);

		// Values (and which contact they belong to) are echoed back on failure, so a
		// rejected form neither loses what was typed nor pre-fills the wrong editor.
		const photo = await readPhoto(form);
		if (!photo.ok) return fail(400, { values: fields, valuesFor: id, message: photo.message });

		const input: ContactInput = { ...fields, photo: photo.photo };
		const contactId = id ?? uuidv7();
		const result = id ? await updateContact(id, input) : await createContact(contactId, input);

		if (!result.ok) {
			// Removes only a file this submission wrote — an unvalidated row would
			// leave it permanently unreachable otherwise. A carried-through photo stays.
			if (photo.photo && photo.photo !== form.get('existingPhoto')) {
				await removeUpload(photo.photo);
			}
			return fail(result.status, { values: fields, valuesFor: id, message: result.message });
		}

		await replaceContactLinks(result.id, readLinks(form));
		return { saved: true };
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const id = form.get('id');
		if (typeof id !== 'string' || !id) return fail(400, { message: 'Which contact?' });

		const result = await deleteContact(id);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { deleted: true };
	},

	/**
	 * File an existing document against a contact. Every contact's panel posts
	 * here with its own `targetId`, so one action serves all of them.
	 */
	attachDocument: async ({ request }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Choose a document to attach.' });
		const result = await attachDocument(targetId, documentId);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	},

	/**
	 * Unfile a document — the link only. The document stays on its shelf, so a
	 * mis-click costs a re-attach rather than evidence.
	 */
	detachDocument: async ({ request }) => {
		const form = await request.formData();
		const targetId = asRowId(form.get('targetId'));
		const documentId = String(form.get('documentId') ?? '').trim();
		if (!documentId) return fail(400, { message: 'Which document?' });
		const result = await detachDocument(targetId, documentId);
		if (!result.ok) return fail(result.status, { message: result.message });
		return { ok: true };
	}
};
