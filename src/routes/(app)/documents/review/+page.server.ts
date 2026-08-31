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
import { asDocumentType, listDocumentTypes } from '$lib/server/documents/types';
import { db } from '$lib/server/db';
import { document, documentLink, tag, tagLink } from '$lib/server/db/schema';
import { upsertTag } from '$lib/server/tags';
import { removeDocument } from '$lib/server/documents/lifecycle';
import { documentTargetSpec, loadPickableTargets } from '$lib/server/documents/targets';
import {
	listShelves,
	shelfIdByKey,
	shelfTypesByKey,
	systemShelfId
} from '$lib/server/documents/shelves';
import { assertVisibleDocument, visibleDocumentPredicate } from '$lib/server/documents/visibility';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const inboxId = await systemShelfId('inbox');
	const [waiting, shelves, targets, tags, shelfTypes, documentTypes] = await Promise.all([
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
		// From the registry, which is the one list. The three hand-written
		// selects this replaces meant a reviewer could file a lease against the
		// flat but never against the tenancy, and a mortgage statement against
		// nobody at all — with nothing on the screen to say a kind was missing.
		loadPickableTargets(),
		db.select({ name: tag.name }).from(tag).orderBy(tag.name),
		shelfTypesByKey(),
		listDocumentTypes()
	]);

	return {
		waiting,
		isAdmin: locals.person?.role === 'admin',
		shelves: shelves.filter((s) => s.key !== 'inbox'),
		// What each shelf offers first, so the picker is as short as the shelf
		// makes it. Never a restriction: the form still accepts any type, and the
		// screen keeps a way to reach all seventeen.
		shelfTypes: Object.fromEntries(shelfTypesByKeyEntries(shelfTypes)),
		// Built-in and household alike; the picker draws from this, not the enum.
		documentTypes,
		knownTags: tags.map((t) => t.name),
		// In registry order, each carrying the heading it belongs under. The
		// kinds a document is filed against from their own screen are absent:
		// a list of every transaction is a list nobody can read by eye.
		targets: targets.map((row) => ({
			...row,
			groupLabel: documentTargetSpec(row.kind).groupLabel
		}))
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
		// The load above lists only what this reviewer may see; this asks the
		// same question of the id that actually came back, because a posted id
		// has been through no list.
		const readable = await assertVisibleDocument(id, locals.person ?? null);
		if (!readable.ok) return fail(readable.status, { message: readable.message });

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
					type: asDocumentType(
						form.get('type'),
						(await listDocumentTypes()).map((row) => row.key)
					),
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
			for (const tagName of form.getAll('tags').map(String).filter(Boolean)) {
				const resolved = await upsertTag(tagName, tx);
				await tx.insert(tagLink).values({ tagId: resolved.id, targetId: id }).onConflictDoNothing();
			}
		});
		return { ok: true, filedId: id };
	},

	/**
	 * Something arrived that should never have: a duplicate, a photo of the
	 * floor. Gone with its file and its links, and the next one takes its place.
	 */
	remove: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });
		const outcome = await removeDocument(id, locals.person);
		if (!outcome.ok) return fail(outcome.status, { message: outcome.message });
		return { ok: true, removedId: id };
	},

	/** Leaving the flow is a navigation, and everything unfiled stays unfiled. */
	leave: async () => redirect(303, '/documents')
};

/** Plain entries, because a Map does not survive the load's serialisation. */
function shelfTypesByKeyEntries(byKey: Map<string, string[]>): [string, string[]][] {
	return [...byKey.entries()];
}
