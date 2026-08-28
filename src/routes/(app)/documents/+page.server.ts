// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * One archive, read through one rule.
 *
 * Every query below carries `visibleDocumentPredicate` and
 * `archiveScopePredicate`, including the counts — a member seeing "27" beside a
 * shelf holding the 26 documents they can open has been told something exists,
 * which is the fact the invariant protects. Searching happens in SQL rather
 * than over the loaded array, because contents live in chunks nobody would ship
 * to a screen.
 */
import { uuidv7 } from 'uuidv7';
import { asEnumValue } from '$lib/enums';
import { extname } from 'node:path';
import { fail } from '@sveltejs/kit';
import { and, count, eq, getTableColumns, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	account,
	document,
	documentLink,
	documentText,
	entity,
	job,
	shelf as shelfTable,
	subject,
	tag,
	tagLink,
	person,
	property
} from '$lib/server/db/schema';
import { saveUpload, saveUploadBytes } from '$lib/server/system/files';
import {
	createDocument,
	deleteDocument,
	replaceDocumentFile
} from '$lib/server/documents/mutations';
import { listShelves, shelfIdByKey } from '$lib/server/documents/shelves';
import { archiveScopePredicate, visibleDocumentPredicate } from '$lib/server/documents/visibility';
import { searchDocuments } from '$lib/server/documents/search';
import { enqueueExtraction } from '$lib/server/documents/extract/queue';
import { runCpuQueue } from '$lib/server/jobs';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const shelf = url.searchParams.get('shelf') ?? 'all';
	const query = url.searchParams.get('q') ?? '';
	const tagFilter = url.searchParams.get('tag') ?? '';
	const includeArchived = url.searchParams.get('archived') === '1';
	const openDocumentId = url.searchParams.get('doc') ?? '';
	const isAdmin = locals.person?.role === 'admin';

	// Other screens open capture pre-addressed by id, never by name:
	// ?add=1&addShelfKey=tenancy&propertyId=…  /  &personId=…
	const addShelfKey = url.searchParams.get('addShelfKey') ?? '';

	const readable = and(
		visibleDocumentPredicate(locals.person),
		archiveScopePredicate(includeArchived)
	);
	// Deliberately without the archive half: this is how many are being hidden.
	const readableEverywhere = visibleDocumentPredicate(locals.person);

	const [
		shelves,
		docs,
		railCounts,
		everywhereCount,
		people,
		properties,
		accounts,
		subjects,
		docLinks,
		docTags,
		tags,
		texts,
		pending
	] = await Promise.all([
		listShelves(),
		// The shelf key travels with the row: the rail filters by key and the
		// label is the household's to change, so neither may be a code list.
		db
			.select({
				...getTableColumns(document),
				shelfKey: shelfTable.key,
				shelfLabel: shelfTable.label
			})
			.from(document)
			.innerJoin(shelfTable, eq(shelfTable.id, document.shelfId))
			.where(readable)
			.orderBy(document.addedOn),
		// Rail counts are computed in SQL, after the read rule and nothing else.
		// They deliberately ignore the search term and the active tag: a rail
		// whose numbers move as you type cannot be used to navigate.
		db
			.select({ key: shelfTable.key, n: count() })
			.from(document)
			.innerJoin(shelfTable, eq(shelfTable.id, document.shelfId))
			.where(readable)
			.groupBy(shelfTable.key),
		db.select({ n: count() }).from(document).where(readableEverywhere),
		db
			.select({ id: person.id, name: person.name })
			.from(person)
			.orderBy(person.createdAt, person.id),
		db.select({ id: property.id, name: property.name }).from(property).orderBy(property.name),
		db
			.select({ id: account.id, name: account.name })
			.from(account)
			.where(eq(account.kind, 'brokerage'))
			.orderBy(account.name),
		db.select().from(subject).orderBy(subject.name),
		// One select for every kind of target; the kind comes from `entity`.
		db
			.select({
				documentId: documentLink.documentId,
				targetId: documentLink.targetId,
				kind: entity.kind
			})
			.from(documentLink)
			.innerJoin(entity, eq(entity.id, documentLink.targetId)),
		db.select({ documentId: tagLink.targetId, tagId: tagLink.tagId }).from(tagLink),
		db.select({ id: tag.id, name: tag.name }).from(tag),
		db
			.select({
				documentId: documentText.documentId,
				complete: documentText.complete,
				pagesExtracted: documentText.pagesExtracted,
				engine: documentText.engine,
				engineVersion: documentText.engineVersion,
				meanConfidence: documentText.meanConfidence,
				languages: documentText.languages
			})
			.from(documentText),
		db
			.select({ documentId: job.subjectId })
			.from(job)
			.where(and(eq(job.kind, 'extract_text'), inArray(job.state, ['queued', 'running'])))
	]);

	const prefill = {
		open: url.searchParams.get('add') === '1',
		shelf: shelves.some((s) => s.key === addShelfKey) ? addShelfKey : '',
		personId: url.searchParams.get('personId') ?? '',
		propertyId: url.searchParams.get('propertyId') ?? ''
	};

	const nameOf = {
		person: new Map(people.map((x) => [x.id, x.name])),
		property: new Map(properties.map((x) => [x.id, x.name])),
		account: new Map(accounts.map((x) => [x.id, x.name])),
		subject: new Map(subjects.map((x) => [x.id, x.name])),
		tag: new Map(tags.map((x) => [x.id, x.name]))
	};
	const archivedSubjects = new Set(subjects.filter((s) => s.archivedAt !== null).map((s) => s.id));

	const entitiesByDoc = new Map<string, string[]>();
	const targetsByDoc = new Map<string, { id: string; kind: string }[]>();
	const archivedByDoc = new Set<string>();
	for (const link of docLinks) {
		const kind = link.kind as keyof typeof nameOf;
		if (!(kind in nameOf) || kind === 'tag') continue;
		const label = nameOf[kind].get(link.targetId);
		if (label)
			entitiesByDoc.set(link.documentId, [...(entitiesByDoc.get(link.documentId) ?? []), label]);
		targetsByDoc.set(link.documentId, [
			...(targetsByDoc.get(link.documentId) ?? []),
			{ id: link.targetId, kind }
		]);
		if (archivedSubjects.has(link.targetId)) archivedByDoc.add(link.documentId);
	}

	const tagsByDoc = new Map<string, string[]>();
	for (const r of docTags) {
		const name = nameOf.tag.get(r.tagId);
		if (name) tagsByDoc.set(r.documentId, [...(tagsByDoc.get(r.documentId) ?? []), name]);
	}

	const textByDoc = new Map(texts.map((t) => [t.documentId, t]));
	const pendingDocs = new Set(pending.map((p) => p.documentId).filter(Boolean) as string[]);

	// Searching happens in SQL, not over the loaded array: the tiers are what
	// make a name match outrank a mention on page forty.
	const search = query
		? await searchDocuments(query, locals.person, {
				includeArchived,
				shelfKey: shelf === 'all' ? undefined : shelf
			})
		: null;
	const hitById = new Map((search?.hits ?? []).map((hit) => [hit.documentId, hit]));

	const shelfCounts = new Map(railCounts.map((r) => [r.key, r.n]));
	const readableTotal = railCounts.reduce((sum, r) => sum + r.n, 0);

	const onShelf = docs.filter((d) => shelf === 'all' || d.shelfKey === shelf);
	const found = search
		? // The order the tiers put them in, not the order they arrived.
			(search.hits
				.map((hit) => onShelf.find((d) => d.id === hit.documentId))
				.filter(Boolean) as typeof onShelf)
		: onShelf;
	const visible = found.filter(
		(d) => !tagFilter || (tagsByDoc.get(d.id) ?? []).includes(tagFilter)
	);

	// Whatever tags exist in this scope become filter chips; the sub-taxonomy
	// stays emergent rather than being another list to maintain.
	const tagCounts = new Map<string, number>();
	for (const d of onShelf)
		for (const t of tagsByDoc.get(d.id) ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
	const tagChips = [...tagCounts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 14)
		.map(([name, n]) => ({ name, count: n, active: name === tagFilter }));

	const rowOf = (d: (typeof docs)[number]) => {
		const text = textByDoc.get(d.id);
		return {
			id: d.id,
			name: d.name,
			type: d.type,
			shelfKey: d.shelfKey,
			shelfLabel: d.shelfLabel,
			entities: entitiesByDoc.get(d.id) ?? [],
			tags: tagsByDoc.get(d.id) ?? [],
			addedOn: d.addedOn,
			periodOn: d.periodOn,
			expiresOn: d.expiresOn,
			expiryVerb: d.expiryVerb,
			subjectArchived: archivedByDoc.has(d.id),
			ext: d.ext,
			hasFile: d.storedName !== null,
			note: d.note,
			// Members never see this field carry `restricted`; the row they cannot
			// see is not in `docs` at all.
			restricted: d.sensitivity === 'restricted',
			extraction: text
				? {
						complete: text.complete,
						pagesExtracted: text.pagesExtracted,
						engine: `${text.engine} ${text.engineVersion}`,
						languages: text.languages,
						meanConfidence: text.meanConfidence
					}
				: null,
			pending: pendingDocs.has(d.id),
			match: hitById.get(d.id)
				? {
						matchedIn: hitById.get(d.id)!.matchedIn,
						pageNo: hitById.get(d.id)!.pageNo,
						snippet: hitById.get(d.id)!.snippet
					}
				: null
		};
	};

	const inboxKey = shelves.find((s) => s.system && s.key === 'inbox')?.key ?? 'inbox';
	const selected = openDocumentId ? docs.find((d) => d.id === openDocumentId) : undefined;

	return {
		shelf,
		query,
		tag: tagFilter,
		includeArchived,
		isAdmin,
		group: url.searchParams.get('group') ?? 'type',
		sort: url.searchParams.get('sort') ?? 'newest',
		// What the screen is allowed to say about what it could not find.
		honesty: search?.honesty ?? null,
		tags: tagChips,
		prefill,
		shelves: [
			{ key: 'all', label: 'Everything', count: readableTotal, system: true, emoji: '' },
			...shelves.map((s) => ({
				key: s.key,
				label: s.label,
				emoji: s.emoji,
				system: s.system,
				count: shelfCounts.get(s.key) ?? 0
			}))
		],
		inboxCount: shelfCounts.get(inboxKey) ?? 0,
		// How many the archive scope is currently hiding — the affordance's number.
		archivedHidden: Math.max(0, (everywhereCount[0]?.n ?? 0) - readableTotal),
		rows: visible.map(rowOf),
		total: visible.length,
		selected: selected
			? {
					...rowOf(selected),
					links: targetsByDoc.get(selected.id) ?? [],
					amountMinor: selected.amountMinor === null ? null : String(selected.amountMinor),
					currency: selected.currency,
					sensitivity: selected.sensitivity
				}
			: null,
		// Checkbox groups for capture and the inspector — records, never
		// suggestions to retype.
		people,
		properties,
		accounts,
		subjects: subjects.map((s) => ({
			id: s.id,
			name: s.name,
			archived: s.archivedAt !== null
		}))
	};
};

/** The one place capture and the inspector agree on what a form field means. */
async function readTags(form: FormData): Promise<string[]> {
	return String(form.get('tags') ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
}

export const actions: Actions = {
	/**
	 * Capture: a file, a generated name, and the Inbox.
	 *
	 * No required enrichment, ever (D10). Everything else on the form is
	 * optional, and a contextual add pre-applies what Continuum already knows.
	 */
	addDocument: async ({ request }) => {
		const form = await request.formData();
		const shelfKey = String(form.get('shelf') ?? '') || 'inbox';
		let shelfId: string;
		try {
			shelfId = await shelfIdByKey(shelfKey);
		} catch {
			return fail(400, { message: 'That shelf no longer exists.' });
		}

		const file = form.get('file');
		let storedName: string | null = null;
		let ext = 'PDF';
		let generated = 'Document';
		if (file instanceof File && file.size > 0) {
			try {
				storedName = await saveUpload(file);
				ext = extname(file.name).replace('.', '').toUpperCase() || 'PDF';
				// The file's own name is the best name available, and a name is
				// never asked for: capture completes with zero decisions.
				generated = file.name.replace(/\.[^.]+$/, '') || 'Document';
			} catch (err) {
				return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
			}
		}

		const name = String(form.get('name') ?? '').trim() || generated;
		if (!storedName && !String(form.get('name') ?? '').trim()) {
			return fail(400, { message: 'Choose a file, or give the document a name.' });
		}

		const documentId = uuidv7();
		await createDocument({
			id: documentId,
			name,
			shelfId,
			type: asEnumValue('document.type', String(form.get('type') ?? 'other'), 'other'),
			note: String(form.get('note') ?? '').trim() || null,
			sensitivity: asEnumValue(
				'document.sensitivity',
				String(form.get('sensitivity') ?? 'normal'),
				'normal'
			),
			storedName,
			ext,
			addedOn: new Date().toISOString().slice(0, 10),
			expiresOn: String(form.get('expiresOn') ?? '').trim() || null,
			expiryVerb: asEnumValue(
				'document.expiry_verb',
				String(form.get('expiryVerb') ?? 'expires'),
				'expires'
			),
			personIds: form.getAll('personIds').map(String),
			propertyIds: form.getAll('propertyIds').map(String),
			accountIds: form.getAll('accountIds').map(String),
			transactionIds: [],
			subjectIds: form.getAll('subjectIds').map(String),
			newSubjectName: String(form.get('newSubject') ?? '').trim() || undefined,
			tagNames: await readTags(form)
		});
		// Extraction is already queued by the mutation; running the queue here is
		// what makes "it is searchable in a moment" true without a cron tick.
		void runCpuQueue().catch(() => undefined);
		return { ok: true, addedId: documentId, addedShelf: shelfKey };
	},

	/** The inspector's Save: metadata only, never the file. */
	updateDocument: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });

		const shelfKey = String(form.get('shelf') ?? '');
		let shelfId: string | undefined;
		if (shelfKey) {
			try {
				shelfId = await shelfIdByKey(shelfKey);
			} catch {
				return fail(400, { message: 'That shelf no longer exists.' });
			}
		}

		await db.transaction(async (tx) => {
			await tx
				.update(document)
				.set({
					name: String(form.get('name') ?? '').trim() || 'Document',
					...(shelfId ? { shelfId } : {}),
					type: asEnumValue('document.type', String(form.get('type') ?? 'other'), 'other'),
					note: String(form.get('note') ?? '').trim() || null,
					expiresOn: String(form.get('expiresOn') ?? '').trim() || null,
					expiryVerb: asEnumValue(
						'document.expiry_verb',
						String(form.get('expiryVerb') ?? 'expires'),
						'expires'
					),
					// Only an admin can restrict, and only an admin can unrestrict:
					// a member's form has no such field and must not be able to send one.
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
			await tx.delete(documentLink).where(eq(documentLink.documentId, id));
			if (linked.length > 0) {
				await tx
					.insert(documentLink)
					.values(linked.map((targetId) => ({ documentId: id, targetId })))
					.onConflictDoNothing();
			}
		});
		return { ok: true };
	},

	/** Put different bytes behind the same record. */
	replaceFile: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const file = form.get('file');
		if (!id) return fail(400, { message: 'Which document?' });
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: 'Choose a file to put in its place.' });
		}
		const bytes = new Uint8Array(await file.arrayBuffer());
		let storedName: string;
		try {
			storedName = await saveUploadBytes(bytes, file.name);
		} catch (err) {
			return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
		}
		const ext = extname(file.name).replace('.', '') || 'pdf';
		const outcome = await replaceDocumentFile(id, { storedName, ext, bytes });
		if (!outcome.ok) return fail(404, { message: 'That document is no longer there.' });
		void runCpuQueue().catch(() => undefined);
		return { ok: true };
	},

	/** Read it again — an admin action, for a file that came back badly. */
	reExtract: async ({ request, locals }) => {
		if (locals.person?.role !== 'admin') return fail(403, { message: 'Admins only.' });
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });
		await db.delete(documentText).where(eq(documentText.documentId, id));
		await enqueueExtraction(id);
		void runCpuQueue().catch(() => undefined);
		return { ok: true };
	},

	/** The next slice of a file that stopped at the automatic limit. */
	continueExtraction: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });
		await enqueueExtraction(id);
		void runCpuQueue().catch(() => undefined);
		return { ok: true };
	},

	/**
	 * Remove a document from the household: the record, its links and the file.
	 */
	deleteDocument: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });
		const outcome = await deleteDocument(id);
		if (!outcome.ok) return fail(404, { id, message: 'That document is no longer there.' });
		return { ok: true };
	},

	/** Bulk edits from the selection bar: additive for links and tags. */
	bulkUpdate: async ({ request, locals }) => {
		const form = await request.formData();
		const ids = form.getAll('ids').map(String).filter(Boolean);
		if (ids.length === 0) return fail(400, { message: 'Nothing was selected.' });

		const shelfKey = String(form.get('shelf') ?? '');
		const type = String(form.get('type') ?? '');
		const sensitivity = String(form.get('sensitivity') ?? '');
		const addTags = await readTags(form);
		const linkIds = form.getAll('linkIds').map(String).filter(Boolean);

		await db.transaction(async (tx) => {
			// Shelf and type REPLACE: a document has one of each. Links and tags
			// ADD: they are sets, and a bulk edit that silently cleared them would
			// be a destructive action disguised as a convenience.
			if (shelfKey) {
				const shelfId = await shelfIdByKey(shelfKey, tx);
				await tx.update(document).set({ shelfId }).where(inArray(document.id, ids));
			}
			if (type) {
				await tx
					.update(document)
					.set({ type: asEnumValue('document.type', type, 'other') })
					.where(inArray(document.id, ids));
			}
			if (sensitivity && locals.person?.role === 'admin') {
				await tx
					.update(document)
					.set({
						sensitivity: asEnumValue('document.sensitivity', sensitivity, 'normal')
					})
					.where(inArray(document.id, ids));
			}
			if (linkIds.length > 0) {
				await tx
					.insert(documentLink)
					.values(ids.flatMap((id) => linkIds.map((targetId) => ({ documentId: id, targetId }))))
					.onConflictDoNothing();
			}
			for (const name of addTags) {
				const { upsertTag } = await import('$lib/server/tags');
				const resolved = await upsertTag(name, tx);
				await tx
					.insert(tagLink)
					.values(ids.map((id) => ({ tagId: resolved.id, targetId: id })))
					.onConflictDoNothing();
			}
		});
		return { ok: true };
	}
};
