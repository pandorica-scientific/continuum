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
	document,
	documentLink,
	documentText,
	entity,
	job,
	shelf as shelfTable,
	tag,
	tagLink
} from '$lib/server/db/schema';
import { saveUploadAndHash, saveUploadBytes, uploadSize } from '$lib/server/system/files';
import { createDocument, replaceDocumentFile } from '$lib/server/documents/mutations';
import {
	removeDocument,
	salaryGuardedDocuments,
	SALARY_ENTRY_REFUSAL
} from '$lib/server/documents/lifecycle';
import {
	addShelf,
	listShelves,
	reassignAndDelete,
	renameShelf,
	reorderShelves,
	shelfIdByKey
} from '$lib/server/documents/shelves';
import {
	addSubject,
	archiveSubject,
	listSubjects,
	renameSubject,
	setSubjectEmoji,
	unarchiveSubject
} from '$lib/server/documents/subjects';
import {
	documentTargetSpec,
	DOCUMENT_TARGET_KINDS,
	isDocumentTargetKind,
	loadPickableTargets,
	loadTargetNames,
	type DocumentTargetKind,
	type TargetRow
} from '$lib/server/documents/targets';
import { linkDiff } from '$lib/document-links';
import { deleteTag } from '$lib/server/tags';
import { loadTagsScreen } from '$lib/server/tags/screen';
import { archiveScopePredicate, visibleDocumentPredicate } from '$lib/server/documents/visibility';
import { searchDocuments } from '$lib/server/documents/search';
import { enqueueExtraction } from '$lib/server/documents/extract/queue';
import { upsertTag } from '$lib/server/tags';
import { runCpuQueue } from '$lib/server/jobs';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const shelf = url.searchParams.get('shelf') ?? 'all';
	const query = url.searchParams.get('q') ?? '';
	// Filters narrow the list and never the rail. Several tags AND together:
	// "insurance" and "car" is the car's insurance, not everything about either.
	const tagFilters = url.searchParams.getAll('tag').filter(Boolean);
	const typeFilter = url.searchParams.get('type') ?? '';
	const entityFilter = url.searchParams.get('entity') ?? '';
	const includeArchived = url.searchParams.get('archived') === '1';
	const openDocumentId = url.searchParams.get('doc') ?? '';
	// The centre column shows the list, or the Tags view. The rail stays put
	// either way — a view is a thing the rail opens, not a screen of its own.
	const view = url.searchParams.get('view') === 'tags' ? 'tags' : 'list';
	const isAdmin = locals.person?.role === 'admin';

	// Other screens open capture pre-addressed by id, never by name:
	// ?add=1&addShelfKey=tenancy&targetKind=tenancy&targetId=…
	// `personId=`/`propertyId=` are the two older spellings of the same thing,
	// kept because links to them are already out in the app.
	const addShelfKey = url.searchParams.get('addShelfKey') ?? '';

	const readable = and(
		visibleDocumentPredicate(locals.person),
		archiveScopePredicate(includeArchived)
	);
	// Deliberately without the archive half: this is how many are being hidden.
	const readableEverywhere = visibleDocumentPredicate(locals.person);

	const [
		shelves,
		subjects,
		docs,
		railCounts,
		everywhereCount,
		pickableTargets,
		docLinks,
		docTags,
		tags,
		texts,
		pending
	] = await Promise.all([
		listShelves(),
		// Behind the same read rule as everything else on this screen: a member
		// seeing "3" beside the car has been told about a document they cannot
		// open. The archive scope is deliberately NOT applied to these counts —
		// see `listSubjects`.
		listSubjects(db, locals.person),
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
		// The kinds the document side may pick, from the registry — which is the
		// one list. Whole, because a picker is a list of what could be chosen.
		// The four hand-written selects this replaces were the reason a receipt's
		// transaction had no name and an ordinary bank account had no chip: one of
		// them asked for brokerage accounts only, because one screen once did.
		// (Names for what the documents point at are read below, by id.)
		loadPickableTargets(),
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

	/** One record a document is filed against, ready to draw as a chip. */
	interface DocumentLinkRow extends TargetRow {
		/** The heading the chip sits under, from the registry. */
		groupLabel: string;
		/** Whether the document side may tick it off, or only unlink it. */
		pickable: boolean;
	}

	// A prefilled capture is addressed by kind and id and resolved through the
	// registry, so a screen added later needs nothing here: `targetKind=loan`
	// works the day `loan` is registered.
	const requested = [
		...url.searchParams.getAll('targetId').map((id) => ({
			kind: url.searchParams.get('targetKind') ?? '',
			id
		})),
		...url.searchParams.getAll('personId').map((id) => ({ kind: 'person', id })),
		...url.searchParams.getAll('propertyId').map((id) => ({ kind: 'property', id }))
	];

	// Names are read for the records THESE documents point at, and for whatever
	// a contextual add pre-addresses — by id, never by table. Unfiltered, the
	// registry reads every kind whole, and `transaction` whole is the household's
	// entire ledger, each row formatted in JS, to label the two receipts on
	// screen.
	//
	// The Tags view draws no list, so it needs no name; the inspector can still
	// be open beside it (`?view=tags&doc=…`), and its links must arrive named —
	// a Save from a panel holding unnamed links is exactly the forgetting this
	// screen was fixed for. So the narrowing is "what is on screen", which for
	// the Tags view is the open document alone and usually nothing at all.
	const namesNeeded = new Set<string>();
	for (const link of docLinks) {
		if (view === 'tags' && link.documentId !== openDocumentId) continue;
		namesNeeded.add(link.targetId);
	}
	for (const { id } of requested) if (id) namesNeeded.add(id);
	const targetNames = await loadTargetNames(db, namesNeeded);

	const targetRow = (kind: DocumentTargetKind, id: string): DocumentLinkRow | undefined => {
		const row = targetNames.get(kind)?.get(id);
		if (!row) return undefined;
		const spec = documentTargetSpec(kind);
		return { ...row, groupLabel: spec.groupLabel, pickable: spec.pickable };
	};

	const prefillTargets: DocumentLinkRow[] = [];
	for (const { kind, id } of requested) {
		if (!id || !isDocumentTargetKind(kind)) continue;
		// Resolved rather than trusted: an id off a URL that names nothing is a
		// hidden input the capture form would post into a foreign key violation.
		const row = targetRow(kind, id);
		if (row) prefillTargets.push(row);
	}

	const prefill = {
		open: url.searchParams.get('add') === '1',
		shelf: shelves.some((s) => s.key === addShelfKey) ? addShelfKey : '',
		targets: prefillTargets
	};

	const tagNameById = new Map(tags.map((x) => [x.id, x.name]));

	const entitiesByDoc = new Map<string, string[]>();
	const targetsByDoc = new Map<string, DocumentLinkRow[]>();
	const archivedByDoc = new Set<string>();
	for (const link of docLinks) {
		// `document_link` points at `entity`, which includes kinds that are not
		// places to file paper — another document, a tag. The registry is what
		// says which of them the screen draws.
		if (!isDocumentTargetKind(link.kind)) continue;
		const row = targetRow(link.kind, link.targetId);
		if (!row) continue;
		entitiesByDoc.set(link.documentId, [...(entitiesByDoc.get(link.documentId) ?? []), row.name]);
		targetsByDoc.set(link.documentId, [...(targetsByDoc.get(link.documentId) ?? []), row]);
		// An archived SUBJECT demotes the paper filed under it. Nothing else does.
		if (row.archived) archivedByDoc.add(link.documentId);
	}

	// Registry order, then by name: the chips under the inspector's About read
	// the same way round on every document, and the read-only kinds sit last
	// because that is where the registry puts them.
	const kindOrder = new Map(DOCUMENT_TARGET_KINDS.map((kind, index) => [kind, index]));
	for (const links of targetsByDoc.values()) {
		links.sort(
			(a, b) =>
				(kindOrder.get(a.kind) ?? 0) - (kindOrder.get(b.kind) ?? 0) || a.name.localeCompare(b.name)
		);
	}

	const tagsByDoc = new Map<string, string[]>();
	for (const r of docTags) {
		const name = tagNameById.get(r.tagId);
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

	// The Inbox is where paper waits, not a shelf among the others: nothing in
	// it appears under Everything until it has been filed. A search still finds
	// it — a person hunting for a document they dropped in an hour ago should
	// not be told it does not exist — and the row says "Inbox".
	const onShelf = docs.filter((d) =>
		shelf === 'all' ? Boolean(query) || d.shelfKey !== 'inbox' : d.shelfKey === shelf
	);
	const found = search
		? // The order the tiers put them in, not the order they arrived.
			(search.hits
				.map((hit) => onShelf.find((d) => d.id === hit.documentId))
				.filter(Boolean) as typeof onShelf)
		: onShelf;
	const visible = found.filter((d) => {
		const tags = tagsByDoc.get(d.id) ?? [];
		if (tagFilters.some((t) => !tags.includes(t))) return false;
		if (typeFilter && d.type !== typeFilter) return false;
		if (entityFilter && !(targetsByDoc.get(d.id) ?? []).some((t) => t.id === entityFilter))
			return false;
		return true;
	});

	// What the filters can offer: every tag, type and entity that appears on
	// the shelf in view, with how many documents each would leave. Derived from
	// the scope rather than the whole archive, so a filter never offers a
	// choice that empties the list.
	const tagCounts = new Map<string, number>();
	const typeCounts = new Map<string, number>();
	// The whole row travels with the count, not just its name. Every kind is
	// named now, so the second lookup that used to search every document's links
	// for the kind of one id — and then a four-kind map for its name — has
	// nothing left to do; and the filter needs the heading and the second line
	// as much as the chips do, because "Alza 2026-03-04" sitting between
	// "Robert" and "Vinohrady flat" in one flat list is unreadable.
	const entityCounts = new Map<string, { row: DocumentLinkRow; count: number }>();
	for (const d of onShelf) {
		for (const t of tagsByDoc.get(d.id) ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
		typeCounts.set(d.type, (typeCounts.get(d.type) ?? 0) + 1);
		for (const t of targetsByDoc.get(d.id) ?? []) {
			const seen = entityCounts.get(t.id);
			entityCounts.set(t.id, { row: t, count: (seen?.count ?? 0) + 1 });
		}
	}
	const filterOptions = {
		tags: [...tagCounts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([name, n]) => ({ name, count: n })),
		types: [...typeCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([code, n]) => ({ code, count: n })),
		// Registry order first, so the groups the screen draws come out in the
		// same order as the chips under About; then by how many documents each
		// would leave. The view groups on `groupLabel` and never re-sorts, which
		// is what keeps one opinion about order rather than two.
		entities: [...entityCounts.values()]
			.filter((e) => e.row.name)
			.sort(
				(a, b) =>
					(kindOrder.get(a.row.kind) ?? 0) - (kindOrder.get(b.row.kind) ?? 0) ||
					b.count - a.count ||
					a.row.name.localeCompare(b.row.name)
			)
			.map((e) => ({
				id: e.row.id,
				name: e.row.name,
				meta: e.row.meta,
				kind: e.row.kind,
				groupLabel: e.row.groupLabel,
				count: e.count
			}))
	};

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
		view,
		tagsScreen: view === 'tags' ? await loadTagsScreen(locals.person ?? null) : null,
		shelf,
		query,
		filters: { tags: tagFilters, type: typeFilter, entity: entityFilter },
		filterOptions,
		includeArchived,
		isAdmin,
		group: url.searchParams.get('group') ?? 'type',
		sort: url.searchParams.get('sort') ?? 'newest',
		// What the screen is allowed to say about what it could not find.
		honesty: search?.honesty ?? null,
		prefill,
		shelves: [
			{
				id: '',
				key: 'all',
				label: 'Everything',
				// Filed paper only. The Inbox has its own row and its own number.
				count: readableTotal - (shelfCounts.get(inboxKey) ?? 0),
				system: true,
				emoji: ''
			},
			...shelves.map((s) => ({
				id: s.id,
				key: s.key,
				label: s.label,
				emoji: s.emoji,
				system: s.system,
				count: shelfCounts.get(s.key) ?? 0
			}))
		],
		// The rail's SUBJECTS section. Archived ones travel too, and the view
		// draws them only under `?archived=1` — the rail says how many it is
		// keeping back, because a subject that vanished from the only screen
		// that can un-archive it would be a one-way door.
		subjects: subjects.map((s) => ({
			id: s.id,
			name: s.name,
			emoji: s.emoji,
			archived: s.archivedAt !== null,
			household: s.household,
			count: s.documentCount
		})),
		inboxCount: shelfCounts.get(inboxKey) ?? 0,
		// How many the archive scope is currently hiding — the affordance's number.
		archivedHidden: Math.max(0, (everywhereCount[0]?.n ?? 0) - readableTotal),
		rows: visible.map(rowOf),
		total: visible.length,
		selected: selected
			? {
					...rowOf(selected),
					// `PDF · 412 kB · added 2026-02-11` — the header's own sub-line.
					fileSize: selected.storedName ? await uploadSize(selected.storedName) : null,
					links: targetsByDoc.get(selected.id) ?? [],
					sensitivity: selected.sensitivity
				}
			: null,
		// Every tag the household has, so the tag field offers them rather than
		// letting a near-miss create a second one.
		knownTags: tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
		// Records the document side may pick, in registry order and carrying the
		// heading each belongs under — never suggestions to retype. A kind it may
		// NOT pick reaches the screen on the document's own `links` instead: it is
		// shown, and it can be unlinked, but it cannot be chosen from a list of
		// every transaction the household has.
		pickableTargets: pickableTargets.map((row) => ({
			...row,
			groupLabel: documentTargetSpec(row.kind).groupLabel
		}))
	};
};

/**
 * The one place capture, the inspector and the bulk bar agree on what the
 * tag field posts: one `tags` input per tag, and a bare comma-separated string
 * still accepted from a plain input.
 */
async function readTags(form: FormData): Promise<string[]> {
	return form
		.getAll('tags')
		.flatMap((value) => String(value).split(','))
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

		// Several files at once is the ordinary case — a folder's worth of scans,
		// a phone's camera roll. Each becomes its own document, named after its
		// file; the optional fields on the form apply to all of them.
		const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
		const typedName = String(form.get('name') ?? '').trim();
		if (files.length === 0 && !typedName) {
			return fail(400, { message: 'Choose a file, or give the document a name.' });
		}

		const shared = {
			shelfId,
			type: asEnumValue('document.type', String(form.get('type') ?? 'other'), 'other'),
			note: String(form.get('note') ?? '').trim() || null,
			sensitivity: asEnumValue(
				'document.sensitivity',
				String(form.get('sensitivity') ?? 'normal'),
				'normal'
			),
			addedOn: new Date().toISOString().slice(0, 10),
			expiresOn: String(form.get('expiresOn') ?? '').trim() || null,
			expiryVerb: asEnumValue(
				'document.expiry_verb',
				String(form.get('expiryVerb') ?? 'expires'),
				'expires'
			),
			// Every record this document was pointed at, ticked in its picker or
			// pre-applied by the screen that sent us here, arrives on `linkIds` and
			// of any registered kind — a per-kind field here could not have carried
			// a tenancy or a loan anyway: no screen ever wrote a `loanIds` input.
			targetIds: form.getAll('linkIds').map(String).filter(Boolean),
			newSubjectName: String(form.get('newSubject') ?? '').trim() || undefined,
			tagNames: await readTags(form)
		};

		const addedIds: string[] = [];
		if (files.length === 0) {
			const documentId = uuidv7();
			await createDocument({
				id: documentId,
				name: typedName,
				storedName: null,
				ext: 'PDF',
				// No file, no bytes to fingerprint.
				contentHash: null,
				...shared
			});
			addedIds.push(documentId);
		}
		for (const file of files) {
			let storedName: string;
			let contentHash: string;
			try {
				({ storedName, contentHash } = await saveUploadAndHash(file));
			} catch (err) {
				return fail(400, { message: err instanceof Error ? err.message : 'Upload failed.' });
			}
			const documentId = uuidv7();
			await createDocument({
				id: documentId,
				// A typed name applies to a single file; several files keep their own.
				name: (files.length === 1 && typedName) || file.name.replace(/\.[^.]+$/, '') || 'Document',
				storedName,
				ext: extname(file.name).replace('.', '').toUpperCase() || 'PDF',
				contentHash,
				...shared
			});
			addedIds.push(documentId);
		}
		void runCpuQueue().catch(() => undefined);
		return { ok: true, addedIds, addedShelf: shelfKey };
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

		const type = asEnumValue('document.type', String(form.get('type') ?? 'other'), 'other');
		const wanted = form.getAll('linkIds').map(String).filter(Boolean);

		// Two edits would quietly orphan the salary a month is credited with —
		// retyping the payslip, and unticking the person the entry belongs to.
		// The rule itself is `salaryGuardedDocuments`, because the bulk bar has
		// to ask the same question about forty documents at once and two
		// spellings of it are two places for it to drift.
		//
		// Refused rather than cascaded: taking the salary entry away as a side
		// effect of an edit to a document would be a far bigger thing than the
		// edit asked for. Removing the payslip is how the entry goes, and that
		// decision belongs on the Salary screen where the figure is visible.
		const guarded = await salaryGuardedDocuments([id], { type, keptTargetIds: wanted });
		if (guarded.length > 0) return fail(409, { message: SALARY_ENTRY_REFUSAL });

		await db.transaction(async (tx) => {
			await tx
				.update(document)
				.set({
					name: String(form.get('name') ?? '').trim() || 'Document',
					...(shelfId ? { shelfId } : {}),
					type,
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

			// A diff, not a replacement. The form carries every link the document
			// has — the pickable kinds as checkboxes, the rest as hidden inputs
			// behind their read-only chips — so what comes back IS the intended
			// set, and what is missing from it was unticked on purpose. Deleting
			// them all first and re-inserting the form's list destroyed every link
			// the picker could not offer: a receipt's transaction, a tax
			// attachment's statement, a bank statement's account.
			// Only the kinds the screen can draw are compared. A link to something
			// the registry does not know is not on the form because no chip could
			// be drawn for it, so leaving it out of `held` is what keeps a save
			// from removing a link nobody was shown — the same failure in a
			// different key.
			const held = await tx
				.select({ targetId: documentLink.targetId })
				.from(documentLink)
				.innerJoin(entity, eq(entity.id, documentLink.targetId))
				.where(
					and(eq(documentLink.documentId, id), inArray(entity.kind, [...DOCUMENT_TARGET_KINDS]))
				);
			const { remove, add } = linkDiff(
				held.map((row) => row.targetId),
				wanted
			);
			if (remove.length > 0) {
				await tx
					.delete(documentLink)
					.where(and(eq(documentLink.documentId, id), inArray(documentLink.targetId, remove)));
			}
			if (add.length > 0) {
				await tx
					.insert(documentLink)
					.values(add.map((targetId) => ({ documentId: id, targetId })))
					.onConflictDoNothing();
			}

			// Tags are replaced with what the form holds: the field shows every tag
			// the document has, so what comes back IS the intended set.
			await tx.delete(tagLink).where(eq(tagLink.targetId, id));
			for (const tagName of form.getAll('tags').map(String).filter(Boolean)) {
				const resolved = await upsertTag(tagName, tx);
				await tx.insert(tagLink).values({ tagId: resolved.id, targetId: id }).onConflictDoNothing();
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
		// `replaceDocumentFile` hashes the bytes itself (it needs them for the
		// document's contentHash), so this can't hand off to `saveUploadAndHash`
		// the way the other actions do — but the read still belongs inside the
		// try, same as theirs, so a broken file fails plainly here too.
		let bytes: Uint8Array;
		let storedName: string;
		try {
			bytes = new Uint8Array(await file.arrayBuffer());
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
	 * Remove a document from the household: the record, its links, the salary
	 * month a payslip evidenced, and the file.
	 */
	deleteDocument: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });
		// Not `deleteDocument`: a payslip's salary entry has to be dealt with
		// before the row goes, and the answer to a member naming restricted
		// paper has to be the same as the answer to naming nothing at all.
		const outcome = await removeDocument(id, locals.person);
		if (!outcome.ok) return fail(outcome.status, { id, message: outcome.message });
		return { ok: true };
	},

	/** Bulk edits from the selection bar: additive for links and tags. */
	bulkUpdate: async ({ request, locals }) => {
		const form = await request.formData();
		const ids = form.getAll('ids').map(String).filter(Boolean);
		if (ids.length === 0) return fail(400, { message: 'Nothing was selected.' });

		const shelfKey = String(form.get('shelf') ?? '');
		const type = String(form.get('type') ?? '');
		// Normalised once, here — the inspector's own `updateDocument` already
		// normalises before its guard call; this bar used to guard on the raw
		// string and only normalise at the write below, two readings of the same
		// field that happened to agree only because nothing but an exact
		// 'payslip' match takes either branch differently. One value now feeds
		// both, the same way the inspector's does. Empty stays empty — asEnumValue
		// would otherwise fall back to the truthy 'other' and turn "no type was
		// selected" into "retype everything to Other".
		const normalisedType = type ? asEnumValue('document.type', type, 'other') : '';
		const sensitivity = String(form.get('sensitivity') ?? '');
		const addTags = await readTags(form);
		const linkIds = form.getAll('linkIds').map(String).filter(Boolean);

		// The same guard the inspector applies, answered for the whole selection
		// at once. A retype reached the UPDATE unchecked here, so the change the
		// inspector refuses could be made to the same payslip by ticking it in
		// the list instead — and the salary entry was orphaned with nothing said.
		//
		// Skipped rather than refused: nothing the person asked for is impossible,
		// and answering a forty-document edit with a failure because one of them
		// is a payslip is a bigger answer than the question. Only `type` is held
		// back — a shelf, a tag or another link takes nothing away from the entry.
		//
		// No `keptTargetIds`: this bar only ADDS links, so it can never untick
		// the person an entry belongs to.
		const guarded = normalisedType
			? await salaryGuardedDocuments(ids, { type: normalisedType })
			: [];
		const retype = ids.filter((id) => !guarded.includes(id));

		await db.transaction(async (tx) => {
			// Shelf and type REPLACE: a document has one of each. Links and tags
			// ADD: they are sets, and a bulk edit that silently cleared them would
			// be a destructive action disguised as a convenience.
			if (shelfKey) {
				const shelfId = await shelfIdByKey(shelfKey, tx);
				await tx.update(document).set({ shelfId }).where(inArray(document.id, ids));
			}
			if (normalisedType && retype.length > 0) {
				await tx.update(document).set({ type: normalisedType }).where(inArray(document.id, retype));
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
				const resolved = await upsertTag(name, tx);
				await tx
					.insert(tagLink)
					.values(ids.map((id) => ({ tagId: resolved.id, targetId: id })))
					.onConflictDoNothing();
			}
		});
		// Said out loud, in the bar's own result slot. A silent skip is the same
		// failure as a silent orphan: the person believes forty documents were
		// retyped, and one of them was not.
		return {
			ok: true,
			skipped: guarded.length,
			...(guarded.length > 0
				? {
						message:
							guarded.length === 1
								? 'One payslip carries a salary entry, so its type was left as it is.'
								: `${guarded.length} payslips carry a salary entry, so their types were left as they are.`
					}
				: {})
		};
	},
	// ---- The rail's own edits: rename, reorder, add, reassign-then-delete ----
	// Deleting a shelf is never a delete: `ON DELETE RESTRICT` on
	// `document.shelf_id` refuses one that still holds paper, so the dialog's
	// "move them to" is the mechanism rather than a courtesy.

	renameShelf: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const label = String(form.get('label') ?? '').trim();
		if (!id || !label) return fail(400, { message: 'A shelf needs a name.' });
		await renameShelf(id, { label, emoji: String(form.get('emoji') ?? '') }, db);
		return { ok: true };
	},

	addShelf: async ({ request }) => {
		const form = await request.formData();
		try {
			await addShelf(String(form.get('label') ?? ''), String(form.get('emoji') ?? '🗂️'), db);
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not add it.' });
		}
		return { ok: true };
	},

	reorderShelves: async ({ request }) => {
		const form = await request.formData();
		const order = String(form.get('order') ?? '')
			.split(',')
			.filter(Boolean);
		if (order.length === 0) return fail(400, { message: 'Nothing to reorder.' });
		await reorderShelves(order, db);
		return { ok: true };
	},

	removeShelf: async ({ request }) => {
		const form = await request.formData();
		try {
			await reassignAndDelete(
				String(form.get('id') ?? ''),
				String(form.get('reassignTo') ?? ''),
				db
			);
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not delete that shelf.'
			});
		}
		return { ok: true };
	},

	// ---- The rail's own edits: subjects ----
	// Archiving is the only "removal" a subject has. A subject that once held
	// paper is history, and history is put away rather than deleted — so there
	// is no `removeSubject` here and there will not be one.

	addSubject: async ({ request }) => {
		const form = await request.formData();
		try {
			await addSubject(String(form.get('name') ?? ''), String(form.get('emoji') ?? ''), db);
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not add it.' });
		}
		return { ok: true };
	},

	/**
	 * The rail's rename row, which edits the name and the emoji at once.
	 *
	 * Both, because one HTML form posts to one action and the row holds both
	 * controls — exactly as `renameShelf` does. The two server functions stay
	 * separate underneath: `setSubjectEmoji` is what the emoji alone means, and
	 * a caller that has not touched the name should not have to send one.
	 */
	renameSubject: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		if (!id || !name) return fail(400, { message: 'A subject needs a name.' });
		try {
			await renameSubject(id, name, db);
			const emoji = form.get('emoji');
			if (emoji !== null) await setSubjectEmoji(id, String(emoji), db);
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not rename it.'
			});
		}
		return { ok: true };
	},

	setSubjectEmoji: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which subject?' });
		await setSubjectEmoji(id, String(form.get('emoji') ?? ''), db);
		return { ok: true };
	},

	/**
	 * Archive a subject: its paper leaves the default view, nothing is deleted.
	 *
	 * The refusal for the household comes back as a sentence a person reads,
	 * not as a control the rail quietly withholds — the rail withholds it too,
	 * but a screen is not where a rule like that may live alone.
	 */
	archiveSubject: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which subject?' });
		try {
			await archiveSubject(id, String(form.get('on') ?? '') || undefined, db);
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not archive it.'
			});
		}
		return { ok: true };
	},

	unarchiveSubject: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which subject?' });
		await unarchiveSubject(id, db);
		return { ok: true };
	},

	/**
	 * Remove a tag. Everything carrying it is untagged by the cascade, and any
	 * rule that applied it stops applying it.
	 */
	deleteTag: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which tag?' });
		if (!(await deleteTag(id))) return fail(404, { message: 'That tag is no longer there.' });
		return { ok: true };
	}
};
