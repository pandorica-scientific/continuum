import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { account, loan, property, tenancy } from '$lib/server/db/schema';
import { saveUpload } from '$lib/server/files';
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

	return {
		query,
		contacts: contacts.map((row) => ({ ...row, links: links.get(row.id) ?? emptyLinks() })),
		options: { tenancies, properties, loans, accounts }
	};
};

/** The submitted text fields, as ContactInput minus the photo. */
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
		const id = typeof form.get('id') === 'string' && form.get('id') ? String(form.get('id')) : null;
		const fields = readFields(form);

		// Echo the submitted values back on every failure path. A rejected form
		// that clears itself makes the reader retype work they already did.
		//
		// WHICH contact they belong to travels with them. Without it the page hands
		// one rejected submission's values to every editor on the screen, so the
		// next contact opened is pre-filled with somebody else's phone and email —
		// and saving that writes them onto the wrong row.
		const photo = await readPhoto(form);
		if (!photo.ok) return fail(400, { values: fields, valuesFor: id, message: photo.message });

		const input: ContactInput = { ...fields, photo: photo.photo };
		const contactId = id ?? randomUUID();
		const result = id ? await updateContact(id, input) : await createContact(contactId, input);

		if (!result.ok) {
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
	}
};
