// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One archive, read through one rule.
 *
 * Every query below carries `archiveScopePredicate`, including the counts.
 * Searching happens in SQL rather than over the loaded array, because contents
 * live in chunks nobody would ship to a screen.
 */
import { uuidv7 } from 'uuidv7';
import { asEnumValue, type DocumentTypeKey } from '$lib/enums';
import { templateEngine, type ShelfEngine } from '$lib/documents/templates';
import { archiveTiles, shelfTiles } from '$lib/documents/shelf-tiles';
import { extname } from 'node:path';
import { fail } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document, documentLink, documentText, entity, tagLink } from '$lib/server/db/schema';
import { saveUploadAndHash, saveUploadBytes, uploadSize } from '$lib/server/system/files';
import { readDocumentsScreen } from '$lib/server/documents/screen';
import { archiveFacts, shelfFacts } from '$lib/server/documents/shelf-tiles';
import { createCard } from '$lib/server/documents/cards';
import { loadQueue } from '$lib/server/documents/queue-load';
import {
	dossierMissing,
	lanesForDocument,
	loadDossier,
	type DossierPayload
} from '$lib/server/documents/dossier-load';
import {
	acceptProposal,
	dismissProposal,
	loadProposals
} from '$lib/server/organisations/proposals-load';
import {
	addEngagement,
	addOrganisation,
	deleteEngagement,
	deleteOrganisation,
	endEngagement,
	listOrganisations,
	renameOrganisation,
	setOrganisationEmoji,
	setOrganisationKind
} from '$lib/server/organisations/mutations';
import {
	coverageAccountCount,
	gapsAcrossYears,
	loadCoverage
} from '$lib/server/statements/coverage-load';
import { firstOfMonth, lastOfMonth } from '$lib/statements/coverage';
import { assignLane, createDocument, replaceDocumentFile } from '$lib/server/documents/mutations';
import {
	identityNumbersFor,
	readIdentityFields,
	readIdentityNumbers,
	replaceIdentityNumbers,
	upsertIdentity
} from '$lib/server/documents/identity';
import {
	removeDocument,
	salaryGuardedDocuments,
	SALARY_ENTRY_REFUSAL
} from '$lib/server/documents/lifecycle';
import {
	addDocumentType,
	asDocumentType,
	documentTypeKeys,
	listDocumentTypes,
	removeDocumentType
} from '$lib/server/documents/types';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
import {
	addShelf,
	listShelves,
	reassignAndDelete,
	renameShelf,
	reorderShelves,
	setShelfTypes,
	shelfIdByKey,
	shelfTypesByKey,
	systemShelfId,
	type ShelfRow
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
	loadTargetNames,
	pickableTargetsForShelf,
	type DocumentTargetKind,
	type TargetRow
} from '$lib/server/documents/targets';
import { linkDiff } from '$lib/documents/links';
import { deleteTag, upsertTag } from '$lib/server/tags';
import { loadTagsScreen } from '$lib/server/tags/screen';
import {
	archiveScopePredicate,
	assertDocumentExists,
	existingDocumentIds,
	NO_SUCH_DOCUMENT
} from '$lib/server/documents/visibility';
import { searchDocuments } from '$lib/server/documents/search';
import { enqueueExtraction } from '$lib/server/documents/extract/queue';
import { runCpuQueue } from '$lib/server/jobs';
import type { Actions, PageServerLoad } from './$types';

/**
 * What the centre column draws: the list, the shelf's own layout, or Tags.
 *
 * `?view=list` forces the list on any shelf, so the choice survives a reload
 * and a shared link. A SEARCH always falls back to the list — a match is
 * explained by a snippet, and a card face has nowhere to put one.
 */
function centreView(
	asked: string | null,
	query: string,
	engine: ShelfEngine | null
): 'tags' | 'list' | 'shelf' {
	if (asked === 'tags') return 'tags';
	if (asked === 'list' || query) return 'list';
	return engine ? 'shelf' : 'list';
}

/** How the list groups when nobody has said otherwise. One default for every shelf. */
const DEFAULT_GROUP = 'type';

/**
 * The types on the shelf, in the order the shelf offers them, then by weight.
 *
 * `shelf_type.ordinal` is what a person dragged into place, so it decides; a
 * type on the shelf that is not in the list follows, heaviest first.
 */
function orderShelfTypes<T extends { code: string; count: number }>(
	types: T[],
	offered: readonly string[]
): T[] {
	const rank = new Map(offered.map((code, i) => [code, i]));
	return [...types].sort((a, b) => {
		const ra = rank.get(a.code) ?? Number.MAX_SAFE_INTEGER;
		const rb = rank.get(b.code) ?? Number.MAX_SAFE_INTEGER;
		return ra - rb || b.count - a.count || a.code.localeCompare(b.code);
	});
}

/** A period whose end precedes its start. Not a period, and not a box to draw. */
const PERIOD_BACKWARDS = Symbol('period backwards');

/**
 * The months a document says it covers, snapped to whole ones.
 *
 * `document_period_first_of_month` and its mirror are whole-month columns, so
 * a person typing the 15th is answered as "this month" rather than refused.
 * An end with no start is dropped rather than refused: half an answer is a
 * person still filling the pair in, not an error.
 */
function coveredMonths(
	form: FormData
): { periodOn: string | null; periodEndOn: string | null } | typeof PERIOD_BACKWARDS {
	const start = String(form.get('periodOn') ?? '').trim();
	const end = String(form.get('periodEndOn') ?? '').trim();
	if (!start) return { periodOn: null, periodEndOn: null };
	if (end && end < start) return PERIOD_BACKWARDS;
	return {
		periodOn: firstOfMonth(start),
		periodEndOn: end ? lastOfMonth(end) : null
	};
}

/** One reading of today for the whole request, so it cannot straddle midnight. */
const bannerToday = (): string => new Date().toISOString().slice(0, 10);

/**
 * A shelf's banner figures, with the two only Statements can answer.
 *
 * `accounts` and `gaps` are coverage facts, not document-row counts, so they
 * come from the coverage loader rather than being recomputed here.
 */
async function tileFactsFor(shelfRow: ShelfRow, dossier: DossierPayload | null) {
	const facts = await shelfFacts(shelfRow);
	if (dossier)
		return {
			...facts,
			cards: dossier.cards.filter((c) => c.id !== null).length,
			missing: dossierMissing(dossier)
		};
	if (templateEngine(shelfRow.template) !== 'completeness') return facts;
	return {
		...facts,
		cards: await coverageAccountCount(),
		missing: await gapsAcrossYears(bannerToday())
	};
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const shelf = url.searchParams.get('shelf') ?? 'all';
	const query = url.searchParams.get('q') ?? '';
	// Several tags AND together: "insurance" and "car" is the car's insurance.
	const tagFilters = url.searchParams.getAll('tag').filter(Boolean);
	const typeFilter = url.searchParams.get('type') ?? '';
	const entityFilter = url.searchParams.get('entity') ?? '';
	const includeArchived = url.searchParams.get('archived') === '1';
	const openDocumentId = url.searchParams.get('doc') ?? '';
	const isAdmin = locals.person?.role === 'admin';

	// A contextual capture is pre-addressed by id: ?add=1&addShelfKey=tenancy&
	// targetKind=tenancy&targetId=… `personId=`/`propertyId=` are older
	// spellings of the same thing, kept because links to them are already live.
	const addShelfKey = url.searchParams.get('addShelfKey') ?? '';

	const readable = archiveScopePredicate(includeArchived);

	const [
		{ docs, railCounts, everywhereCount, docLinks, docTags, tags, texts, pending, identities },
		shelves,
		subjects,
		shelfTypes,
		documentTypes
	] = await Promise.all([
		readDocumentsScreen({ readable }),
		listShelves(),
		// Archive scope is deliberately NOT applied to these counts — see `listSubjects`.
		listSubjects(db),
		shelfTypesByKey(),
		listDocumentTypes()
	]);

	// A shelf is one question, one unit, one template, all read off the row.
	const shelfRow = shelf === 'all' ? null : (shelves.find((s) => s.key === shelf) ?? null);
	const engine = shelfRow ? templateEngine(shelfRow.template) : null;
	const view = centreView(url.searchParams.get('view'), query, engine);

	// A document belongs to one shelf and never links across shelves, so a
	// car's paper is offered the cars and not the boiler.
	const shelfTargets = await pickableTargetsForShelf(shelfRow, db);

	// The Inbox IS the queue: filing is what the shelf is for.
	const queue =
		view === 'shelf' && engine === 'queue'
			? await loadQueue(db, bannerToday(), openDocumentId)
			: null;

	// Drawn whatever the view: the band answers the SHELF's question, and the
	// question does not change because somebody pressed List.
	const dossier =
		engine === 'dossier' && shelfRow
			? await loadDossier(
					shelfRow,
					Number(url.searchParams.get('year')) || Number(bannerToday().slice(0, 4)),
					db,
					bannerToday()
				)
			: null;

	/** One record a document is filed against, ready to draw as a chip. */
	interface DocumentLinkRow extends TargetRow {
		/** The heading the chip sits under, from the registry. */
		groupLabel: string;
		/** Whether the document side may tick it off, or only unlink it. */
		pickable: boolean;
	}

	const requested = [
		...url.searchParams.getAll('targetId').map((id) => ({
			kind: url.searchParams.get('targetKind') ?? '',
			id
		})),
		...url.searchParams.getAll('personId').map((id) => ({ kind: 'person', id })),
		...url.searchParams.getAll('propertyId').map((id) => ({ kind: 'property', id }))
	];

	// Names are read only for what's on screen: the links these documents
	// carry, and any contextual-add prefill. The Tags view draws no list, so
	// only the open document's links (if any) need a name there.
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
		// Resolved rather than trusted: a URL id that names nothing must not
		// become a hidden input the capture form posts as a foreign key violation.
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
		// `document_link` also points at kinds that aren't filing targets
		// (another document, a tag); the registry says which ones are.
		if (!isDocumentTargetKind(link.kind)) continue;
		const row = targetRow(link.kind, link.targetId);
		if (!row) continue;
		entitiesByDoc.set(link.documentId, [...(entitiesByDoc.get(link.documentId) ?? []), row.name]);
		targetsByDoc.set(link.documentId, [...(targetsByDoc.get(link.documentId) ?? []), row]);
		// An archived SUBJECT demotes the paper filed under it. Nothing else does.
		if (row.archived) archivedByDoc.add(link.documentId);
	}

	// Registry order, then by name, so the chips under About read the same way
	// on every document.
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
	const identityByDoc = new Map(identities.map((row) => [row.documentId, row]));

	/** The two identity fields a row may show, or null when it has none. */
	const identityFor = (documentId: string) => {
		const row = identityByDoc.get(documentId);
		return row ? { kind: row.kind, country: row.country, number: row.number ?? null } : null;
	};

	const search = query
		? await searchDocuments(query, {
				includeArchived,
				shelfKey: shelf === 'all' ? undefined : shelf
			})
		: null;
	const hitById = new Map((search?.hits ?? []).map((hit) => [hit.documentId, hit]));

	const shelfCounts = new Map(railCounts.map((r) => [r.key, r.n]));
	const readableTotal = railCounts.reduce((sum, r) => sum + r.n, 0);

	// The Inbox is where paper waits, not a shelf among the others: nothing in
	// it appears under Everything until filed. A search still finds it.
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

	// What the filters can offer, derived from the scope rather than the whole
	// archive, so a filter never offers a choice that empties the list.
	const tagCounts = new Map<string, number>();
	const typeCounts = new Map<string, number>();
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
		// What the shelf expects first, then by how many documents each would
		// leave: Identity's type filter starts with Identity document, not
		// whatever happens to be most numerous.
		types: orderShelfTypes(
			[...typeCounts.entries()].map(([code, n]) => ({ code, count: n })),
			shelfTypes.get(shelf) ?? []
		),
		// Registry order first, matching the chips under About; then by count.
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
			// Same links as `entities`, by id and kind, for a layout that groups
			// by section header rather than a sub-line of names.
			about: (targetsByDoc.get(d.id) ?? []).map(({ id, kind, name }) => ({ id, kind, name })),
			tags: tagsByDoc.get(d.id) ?? [],
			addedOn: d.addedOn,
			periodOn: d.periodOn,
			periodEndOn: d.periodEndOn,
			expiresOn: d.expiresOn,
			expiryVerb: d.expiryVerb,
			subjectArchived: archivedByDoc.has(d.id),
			// The document NUMBER is deliberately absent — a card face is glanced
			// at with other people in the room.
			identity: identityFor(d.id),
			ext: d.ext,
			hasFile: d.storedName !== null,
			note: d.note,
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

	// A lane belongs to one card, so a document naming no card has none to
	// choose from — and off a dossier shelf there are no lanes at all.
	const selectedLanes =
		selected && engine === 'dossier' ? await lanesForDocument(selected.id, shelfRow, db) : [];

	return {
		view,
		tagsScreen: view === 'tags' ? await loadTagsScreen() : null,
		shelf,
		query,
		filters: { tags: tagFilters, type: typeFilter, entity: entityFilter },
		filterOptions,
		includeArchived,
		isAdmin,
		// The shelf's own default, so Finance opens by year and Identity by who
		// it is about.
		group: url.searchParams.get('group') ?? DEFAULT_GROUP,
		defaultGroup: DEFAULT_GROUP,
		documentTypes,
		/** The layout being drawn, or null whenever the centre column is the list. */
		layout: view === 'shelf' ? engine : null,
		/** What this shelf COULD draw, so the toolbar can offer the switch. */
		shelfLayout: engine,
		emptyHint: shelfRow?.question ?? null,
		/**
		 * What the screen is called and what it is for.
		 *
		 * The shelf IS the screen: its name is the title and its question is the
		 * caption. "Documents" is shown only on Everything, which has no one
		 * question.
		 */
		screen: shelfRow
			? {
					emoji: shelfRow.emoji,
					label: shelfRow.label,
					count: railCounts.find((c) => c.key === shelfRow.key)?.n ?? 0,
					question: shelfRow.question
				}
			: {
					emoji: '🗂️',
					label: 'Everything',
					// `everywhereCount` is a row array, read as `everywhereCount[0]?.n`.
					count: everywhereCount[0]?.n ?? 0,
					question:
						'One archive for the household. Shelf is where in life, type is what kind, links are what it concerns.'
				},
		/** The three figures, chosen by the shelf's engine. */
		tiles: shelfRow
			? shelfTiles(engine!, await tileFactsFor(shelfRow, dossier))
			: archiveTiles(await archiveFacts()),
		/** The rail's third section. Counted behind the same read rule as everything else here. */
		organisations: await listOrganisations(db),
		/**
		 * What the lanes think should be filed, and where.
		 *
		 * Computed, never stored: a stored proposal goes stale the moment a lane
		 * is edited or the document is filed by hand.
		 */
		proposals: view === 'shelf' && engine === 'dossier' ? await loadProposals(db) : [],
		/** The cards, or null when the centre column draws the list. */
		dossier: view === 'shelf' ? dossier : null,
		/** The Inbox's own queue, or null. */
		queue,
		/** The lanes of the OPEN document's card, for the inspector's Lane picker. */
		selectedLanes,
		/** Card ids collapsed to one line. In the address, so a bookmark keeps it. */
		closed: (url.searchParams.get('closed') ?? '').split(',').filter(Boolean),
		/** The ribbon, or null whenever the centre column doesn't draw it. */
		coverage:
			view === 'shelf' && engine === 'completeness'
				? await loadCoverage(
						Number(url.searchParams.get('year')) || Number(bannerToday().slice(0, 4)),
						bannerToday(),
						undefined,
						Number(url.searchParams.get('decade')) || undefined
					)
				: null,
		sort: url.searchParams.get('sort') ?? 'newest',
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
				emoji: '',
				types: [] as DocumentTypeKey[]
			},
			...shelves.map((s) => ({
				id: s.id,
				key: s.key,
				label: s.label,
				emoji: s.emoji,
				system: s.system,
				count: shelfCounts.get(s.key) ?? 0,
				types: shelfTypes.get(s.key) ?? []
			}))
		],
		// Archived subjects travel too, drawn only under `?archived=1`, with the
		// rail saying how many it is keeping back.
		subjects: subjects.map((s) => ({
			id: s.id,
			name: s.name,
			emoji: s.emoji,
			archived: s.archivedAt !== null,
			count: s.documentCount
		})),
		inboxCount: shelfCounts.get(inboxKey) ?? 0,
		archivedHidden: Math.max(0, (everywhereCount[0]?.n ?? 0) - readableTotal),
		rows: visible.map(rowOf),
		total: visible.length,
		selected: selected
			? {
					...rowOf(selected),
					// `PDF · 412 kB · added 2026-02-11`.
					fileSize: selected.storedName ? await uploadSize(selected.storedName) : null,
					// Masked until asked for; sent for every selected document since a
					// retyped document keeps its identity fields.
					identityDetail: identityByDoc.get(selected.id) ?? null,
					identityNumbers: await identityNumbersFor(selected.id),
					links: targetsByDoc.get(selected.id) ?? [],
					laneId: selected.laneId
				}
			: null,
		knownTags: tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
		// A kind the document side may NOT pick reaches the screen on the
		// document's own `links` instead — shown and unlinkable, but not
		// choosable from a list of every transaction the household has.
		pickableTargets: shelfTargets.map((row) => ({
			...row,
			groupLabel: documentTargetSpec(row.kind).groupLabel
		}))
	};
};

/**
 * The one place capture, the inspector and the bulk bar agree on what the
 * tag field posts: one `tags` input per tag, a comma-separated string still accepted.
 */
async function readTags(form: FormData): Promise<string[]> {
	return form
		.getAll('tags')
		.flatMap((value) => String(value).split(','))
		.map((t) => t.trim())
		.filter(Boolean);
}

export const actions: Actions = {
	/** Capture: a file, a generated name, and the Inbox. No required enrichment, ever. */
	addDocument: async ({ request }) => {
		const form = await request.formData();
		const shelfKey = String(form.get('shelf') ?? '') || 'inbox';
		let shelfId: string;
		try {
			shelfId = await shelfIdByKey(shelfKey);
		} catch {
			return fail(400, { message: 'That shelf no longer exists.' });
		}

		// Several files at once becomes several documents, named after each file.
		const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
		const typedName = String(form.get('name') ?? '').trim();
		if (files.length === 0 && !typedName) {
			return fail(400, { message: 'Choose a file, or give the document a name.' });
		}

		const shared = {
			shelfId,
			type: asDocumentType(form.get('type'), await documentTypeKeys()),
			note: String(form.get('note') ?? '').trim() || null,
			addedOn: new Date().toISOString().slice(0, 10),
			expiresOn: String(form.get('expiresOn') ?? '').trim() || null,
			expiryVerb: asEnumValue(
				'document.expiry_verb',
				String(form.get('expiryVerb') ?? 'expires'),
				'expires'
			),
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
	updateDocument: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });
		const present = await assertDocumentExists(id);
		if (!present.ok) return fail(present.status, { message: present.message });

		const shelfKey = String(form.get('shelf') ?? '');
		let shelfId: string | undefined;
		if (shelfKey) {
			try {
				shelfId = await shelfIdByKey(shelfKey);
			} catch {
				return fail(400, { message: 'That shelf no longer exists.' });
			}
		}

		const type = asDocumentType(form.get('type'), await documentTypeKeys());
		const wanted = form.getAll('linkIds').map(String).filter(Boolean);

		// A retype or unlink can orphan the salary a payslip evidences; refused
		// here rather than cascaded, since dropping the entry is a bigger thing
		// than the edit asked for. Removing the payslip is how the entry goes.
		const guarded = await salaryGuardedDocuments([id], { type, keptTargetIds: wanted });
		if (guarded.length > 0) return fail(409, { message: SALARY_ENTRY_REFUSAL });

		const period = coveredMonths(form);
		if (period === PERIOD_BACKWARDS) {
			return fail(400, { message: 'A statement cannot stop covering months before it starts.' });
		}

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
					...period
				})
				.where(eq(document.id, id));

			// A diff, not a replacement: the form carries every link the document
			// has, so re-inserting it wholesale would destroy links the picker
			// can't offer (a receipt's transaction, a statement's account). Only
			// the kinds the screen can draw are compared, so an unlisted link is
			// never mistaken for one that was unticked.
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

			// Identity fields are written only for `id_document`, never cleared for
			// anything else — a mis-set dropdown costs a click, not five fields.
			if (type === 'id_document') {
				await upsertIdentity(id, readIdentityFields(form), tx);
				// After the upsert: the numbers hang off the identity record.
				await replaceIdentityNumbers(id, readIdentityNumbers(form), tx);
			}

			// Tags are replaced with what the form holds.
			await tx.delete(tagLink).where(eq(tagLink.targetId, id));
			for (const tagName of form.getAll('tags').map(String).filter(Boolean)) {
				const resolved = await upsertTag(tagName, tx);
				await tx.insert(tagLink).values({ tagId: resolved.id, targetId: id }).onConflictDoNothing();
			}

			// Last, and only when the picker was shown: the lane is checked
			// against the links just written.
			if (form.has('laneId')) await assignLane(id, String(form.get('laneId')) || null, tx);
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
		// Before the upload is saved: a refusal after would leave litter behind it.
		const present = await assertDocumentExists(id);
		if (!present.ok) return fail(present.status, { message: present.message });
		// `replaceDocumentFile` hashes the bytes itself, so this reads the file
		// directly rather than through `saveUploadAndHash`.
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
		const present = await assertDocumentExists(id);
		if (!present.ok) return fail(present.status, { message: present.message });
		await enqueueExtraction(id);
		void runCpuQueue().catch(() => undefined);
		return { ok: true };
	},

	/** Remove a document: the record, its links, its salary month, and the file. */
	deleteDocument: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });
		// Not a plain delete: a payslip's salary entry has to be dealt with first.
		const outcome = await removeDocument(id);
		if (!outcome.ok) return fail(outcome.status, { id, message: outcome.message });
		return { ok: true };
	},

	/** Bulk edits from the selection bar: additive for links and tags. */
	bulkUpdate: async ({ request }) => {
		const form = await request.formData();
		const selected = form.getAll('ids').map(String).filter(Boolean);
		if (selected.length === 0) return fail(400, { message: 'Nothing was selected.' });
		// Narrowed to ids that are really there; a stale id doesn't refuse the batch.
		const ids = await existingDocumentIds(selected);
		if (ids.length === 0) return fail(404, { message: NO_SUCH_DOCUMENT });

		const shelfKey = String(form.get('shelf') ?? '');
		const type = String(form.get('type') ?? '');
		// Empty stays empty here — asEnumValue would otherwise fall back to
		// 'other' and turn "no type selected" into "retype everything to Other".
		const normalisedType = type ? asDocumentType(type, await documentTypeKeys()) : '';
		const addTags = await readTags(form);
		const linkIds = form.getAll('linkIds').map(String).filter(Boolean);

		// Same salary guard as the inspector, applied to the whole selection.
		// Skipped rather than refused — a 40-document edit shouldn't fail
		// because one of them is a payslip. Only `type` is held back; no
		// `keptTargetIds`, since this bar only adds links.
		const guarded = normalisedType
			? await salaryGuardedDocuments(ids, { type: normalisedType })
			: [];
		const retype = ids.filter((id) => !guarded.includes(id));

		await db.transaction(async (tx) => {
			// Shelf and type REPLACE (a document has one of each); links and tags ADD.
			if (shelfKey) {
				const shelfId = await shelfIdByKey(shelfKey, tx);
				await tx.update(document).set({ shelfId }).where(inArray(document.id, ids));
			}
			if (normalisedType && retype.length > 0) {
				await tx.update(document).set({ type: normalisedType }).where(inArray(document.id, retype));
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
	// `document.shelf_id` refuses one that still holds paper.

	renameShelf: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const label = String(form.get('label') ?? '').trim();
		if (!id || !label) return fail(400, { message: 'A shelf needs a name.' });
		await renameShelf(id, { label, emoji: String(form.get('emoji') ?? '') }, db);
		return { ok: true };
	},

	/**
	 * Which types a shelf offers first. A list, never a rule: the picker gets
	 * shorter but nothing is refused.
	 */
	setShelfTypes: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Which shelf?' });
		// Filtered against what this household HAS, not the shipped enum —
		// otherwise the foreign key refuses the write with a raw constraint name.
		const known = new Set(await documentTypeKeys());
		const types = form
			.getAll('types')
			.map(String)
			.filter((code) => known.has(code));
		await setShelfTypes(id, types, db);
		return { ok: true };
	},

	/**
	 * A kind of paper this household files that the app did not ship.
	 * Idempotent by key: adding one that exists selects it rather than refusing.
	 */
	addDocumentType: async ({ request }) => {
		const form = await request.formData();
		try {
			await addDocumentType(String(form.get('label') ?? ''), db);
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not add it.' });
		}
		return { ok: true };
	},

	/** Only one the household added, and only while nothing is filed as it. */
	removeDocumentType: async ({ request }) => {
		const form = await request.formData();
		try {
			await removeDocumentType(String(form.get('key') ?? ''), db);
		} catch (error) {
			return fail(409, {
				message: error instanceof Error ? error.message : 'Could not remove it.'
			});
		}
		return { ok: true };
	},

	addShelf: async ({ request }) => {
		const form = await request.formData();
		try {
			await addShelf(
				{
					label: String(form.get('label') ?? ''),
					emoji: String(form.get('emoji') ?? '🗂️'),
					template: asEnumValue('shelf.template', String(form.get('template') ?? ''), 'dossier'),
					unit: asEnumValue('shelf.unit', String(form.get('unit') ?? ''), 'subject'),
					question: String(form.get('question') ?? '')
				},
				db
			);
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
	// Archiving is the only "removal" a subject has: history is put away
	// rather than deleted, so there is no `removeSubject`.

	addOrganisation: async ({ request }) => {
		const form = await request.formData();
		try {
			await addOrganisation(
				{
					name: String(form.get('name') ?? ''),
					shelfId: await systemShelfId(SYSTEM_SHELF_KEYS.incomeTax),
					kind: asEnumValue('organisation.kind', String(form.get('kind') ?? 'other'), 'other'),
					emoji: String(form.get('emoji') ?? '')
				},
				db
			);
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not add it.' });
		}
		return { ok: true };
	},

	/** The rail's rename row: name, emoji and kind at once, as a subject's does. */
	renameOrganisation: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const name = String(form.get('name') ?? '').trim();
		if (!id || !name) return fail(400, { message: 'An organisation needs a name.' });
		try {
			await renameOrganisation(id, name, db);
			const emoji = form.get('emoji');
			if (emoji !== null) await setOrganisationEmoji(id, String(emoji), db);
			const kind = form.get('kind');
			if (kind !== null) {
				await setOrganisationKind(id, asEnumValue('organisation.kind', String(kind), 'other'), db);
			}
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not rename it.'
			});
		}
		return { ok: true };
	},

	deleteOrganisation: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Nothing to remove.' });
		try {
			await deleteOrganisation(id, db);
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not remove it.'
			});
		}
		return { ok: true };
	},

	acceptProposal: async ({ request }) => {
		const form = await request.formData();
		const documentId = String(form.get('documentId') ?? '').trim();
		const laneId = String(form.get('laneId') ?? '').trim();
		const organisationId = String(form.get('organisationId') ?? '').trim();
		if (!documentId || !laneId || !organisationId) {
			return fail(400, { message: 'Nothing to file.' });
		}
		const result = await acceptProposal(documentId, laneId, organisationId, db);
		if (!result.ok) return fail(404, { message: result.message ?? NO_SUCH_DOCUMENT });
		return { ok: true };
	},

	/** Files nothing. What changes is the lane's standing — see `dismissProposal`. */
	dismissProposal: async ({ request }) => {
		const form = await request.formData();
		const laneId = String(form.get('laneId') ?? '').trim();
		if (!laneId) return fail(400, { message: 'Nothing to dismiss.' });
		await dismissProposal(laneId, db);
		return { ok: true };
	},

	addEngagement: async ({ request }) => {
		const form = await request.formData();
		const organisationId = String(form.get('organisationId') ?? '').trim();
		const personId = String(form.get('personId') ?? '').trim();
		if (!organisationId || !personId) {
			return fail(400, { message: 'A role period needs a person and an organisation.' });
		}
		try {
			await addEngagement(
				{
					organisationId,
					personId,
					role: String(form.get('role') ?? ''),
					startsOn: String(form.get('startsOn') ?? '') || null
				},
				db
			);
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not add the role.'
			});
		}
		return { ok: true };
	},

	/** Closes a period rather than removing it — see `endEngagement` for why. */
	endEngagement: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const endsOn = String(form.get('endsOn') ?? '').trim();
		if (!id || !endsOn) return fail(400, { message: 'A closing date is needed.' });
		try {
			await endEngagement(id, endsOn, db);
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : 'Could not close the role.'
			});
		}
		return { ok: true };
	},

	/** For one entered by mistake. Ending a real one is `endEngagement`. */
	deleteEngagement: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Nothing to remove.' });
		await deleteEngagement(id, db);
		return { ok: true };
	},

	/**
	 * File the document in front of the queue: the shelf, the card on it, the
	 * lane on that card, in one post. A card can be made on the way past
	 * (`newCardName`) so the paper isn't lost sending the person elsewhere.
	 * Skip is not an action — passing over a document never reaches the server.
	 */
	fileFromQueue: async ({ request, locals }) => {
		if (!locals.person) return fail(401, { message: 'Sign in first.' });
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });
		const present = await assertDocumentExists(id);
		if (!present.ok) return fail(present.status, { message: present.message });

		let shelfId: string;
		try {
			shelfId = await shelfIdByKey(String(form.get('shelf') ?? ''));
		} catch {
			return fail(400, { message: 'Pick a shelf.' });
		}

		const laneId = String(form.get('laneId') ?? '').trim();
		const newCardName = String(form.get('newCardName') ?? '').trim();
		let cardId = String(form.get('cardId') ?? '').trim();

		const type = asDocumentType(form.get('type'), await documentTypeKeys());

		try {
			await db.transaction(async (tx) => {
				// A card made on the way past, before anything is linked to it.
				if (!cardId && newCardName) {
					const made = await createCard({ shelfId, name: newCardName }, tx);
					cardId = made.id;
				}

				await tx
					.update(document)
					.set({
						name: String(form.get('name') ?? '').trim() || 'Document',
						shelfId,
						type,
						note: String(form.get('note') ?? '').trim() || null,
						expiresOn: String(form.get('expiresOn') ?? '').trim() || null,
						expiryVerb: asEnumValue(
							'document.expiry_verb',
							String(form.get('expiryVerb') ?? 'expires'),
							'expires'
						)
					})
					.where(eq(document.id, id));

				// Same terms as the inspector: identity fields only for
				// `id_document`, numbers only after the record exists.
				if (type === 'id_document') {
					await upsertIdentity(id, readIdentityFields(form), tx);
					await replaceIdentityNumbers(id, readIdentityNumbers(form), tx);
				}

				if (cardId)
					await tx
						.insert(documentLink)
						.values({ documentId: id, targetId: cardId })
						.onConflictDoNothing();

				// After the link: a lane may only hold paper on its own card.
				if (laneId) await assignLane(id, laneId, tx);

				for (const tagName of await readTags(form)) {
					const resolved = await upsertTag(tagName, tx);
					await tx
						.insert(tagLink)
						.values({ tagId: resolved.id, targetId: id })
						.onConflictDoNothing();
				}
			});
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not file it.' });
		}
		return { ok: true, filedId: id };
	},

	/**
	 * A card on a dossier shelf: a subject or an organisation, with the lanes
	 * its shelf seeds. One action for both — which table it lands in is a fact
	 * about the shelf, not about what the person did.
	 */
	addCard: async ({ request, locals }) => {
		if (!locals.person) return fail(401, { message: 'Sign in first.' });
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { message: 'A card needs a name.' });
		try {
			const shelfId = await shelfIdByKey(String(form.get('shelf') ?? ''));
			const kindField = form.get('kind');
			const card = await createCard({
				shelfId,
				name,
				emoji: String(form.get('emoji') ?? '') || undefined,
				kind: kindField ? asEnumValue('organisation.kind', String(kindField), 'other') : undefined
			});
			return { ok: true, cardId: card.id };
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not add it.' });
		}
	},

	addSubject: async ({ request }) => {
		const form = await request.formData();
		try {
			const shelfKey = String(form.get('shelf') ?? '');
			await addSubject(
				String(form.get('name') ?? ''),
				String(form.get('emoji') ?? ''),
				await shelfIdByKey(shelfKey || SYSTEM_SHELF_KEYS.inbox),
				db
			);
		} catch (error) {
			return fail(400, { message: error instanceof Error ? error.message : 'Could not add it.' });
		}
		return { ok: true };
	},

	/** The rail's rename row, which edits the name and the emoji at once. */
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

	/** Archive a subject: its paper leaves the default view, nothing is deleted. */
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

	/** Remove a tag. Everything carrying it is untagged by the cascade. */
	deleteTag: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which tag?' });
		if (!(await deleteTag(id))) return fail(404, { message: 'That tag is no longer there.' });
		return { ok: true };
	}
};
