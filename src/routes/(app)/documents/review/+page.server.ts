// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Inbox review: preview on the left, the fields on the right, one document at
 * a time.
 *
 * Purpose-built rather than the inspector in a loop, because the cadence is
 * different: this flow touches every backlog document exactly once, so it asks
 * for expiry and sensitivity too — the two fields a second pass costs most.
 * Everything stays optional (D10).
 */
import { and, asc, eq } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
import { asEnumValue } from '$lib/enums';
import { db } from '$lib/server/db';
import { document, documentLink, person, property, subject } from '$lib/server/db/schema';
import { listShelves, shelfIdByKey, systemShelfId } from '$lib/server/documents/shelves';
import { visibleDocumentPredicate } from '$lib/server/documents/visibility';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const inboxId = await systemShelfId('inbox');
	const [waiting, shelves, people, properties, subjects] = await Promise.all([
		db
			.select({
				id: document.id,
				name: document.name,
				ext: document.ext,
				storedName: document.storedName,
				addedOn: document.addedOn
			})
			.from(document)
			.where(and(eq(document.shelfId, inboxId), visibleDocumentPredicate(locals.person)))
			.orderBy(asc(document.addedOn), asc(document.id)),
		listShelves(),
		db.select({ id: person.id, name: person.name }).from(person).orderBy(person.name),
		db.select({ id: property.id, name: property.name }).from(property).orderBy(property.name),
		db.select({ id: subject.id, name: subject.name }).from(subject).orderBy(subject.name)
	]);

	return {
		waiting,
		isAdmin: locals.person?.role === 'admin',
		shelves: shelves.filter((s) => s.key !== 'inbox'),
		targets: [
			...people.map((p) => ({ ...p, kind: 'person' })),
			...properties.map((p) => ({ ...p, kind: 'property' })),
			...subjects.map((s) => ({ ...s, kind: 'subject' }))
		]
	};
};

export const actions: Actions = {
	/**
	 * File the document in front of the reviewer and move on.
	 *
	 * Skip is not an action here: passing over a document changes nothing, so it
	 * never reaches the server.
	 */
	file: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });

		const shelfKey = String(form.get('shelf') ?? '');
		let shelfId: string;
		try {
			shelfId = await shelfIdByKey(shelfKey);
		} catch {
			return fail(400, { message: 'Pick a shelf.' });
		}

		await db.transaction(async (tx) => {
			await tx
				.update(document)
				.set({
					name: String(form.get('name') ?? '').trim() || 'Document',
					shelfId,
					type: asEnumValue('document.type', String(form.get('type') ?? 'other'), 'other'),
					note: String(form.get('note') ?? '').trim() || null,
					expiresOn: String(form.get('expiresOn') ?? '').trim() || null,
					expiryVerb: asEnumValue(
						'document.expiry_verb',
						String(form.get('expiryVerb') ?? 'expires'),
						'expires'
					),
					...(locals.person?.role === 'admin'
						? {
								sensitivity: asEnumValue(
									'document.sensitivity',
									String(form.get('sensitivity') ?? 'normal'),
									'normal'
								)
							}
						: {})
				})
				.where(eq(document.id, id));

			const linked = form.getAll('linkIds').map(String).filter(Boolean);
			if (linked.length > 0) {
				await tx
					.insert(documentLink)
					.values(linked.map((targetId) => ({ documentId: id, targetId })))
					.onConflictDoNothing();
			}
		});
		return { ok: true, filedId: id };
	},

	/** Leaving the flow is a navigation, and everything unfiled stays unfiled. */
	leave: async () => redirect(303, '/documents')
};
