// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { asEnumValue, type DocumentTypeKey } from '$lib/enums';
import { orderTypeOptions, shelfProfile, type ShelfLayout } from '$lib/shelf-profiles';
import { extname } from 'node:path';
import { fail } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { document, documentLink, documentText, entity, tagLink } from '$lib/server/db/schema';
import { saveUploadAndHash, saveUploadBytes, uploadSize } from '$lib/server/system/files';
import { readDocumentsScreen } from '$lib/server/documents/screen';
import { shelfFacts } from '$lib/server/documents/shelf-stats';
import { loadCounterparties } from '$lib/server/organisations/counterparties-load';
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
import { createDocument, replaceDocumentFile } from '$lib/server/documents/mutations';
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
import {
	addShelf,
	listShelves,
	reassignAndDelete,
	renameShelf,
	reorderShelves,
	setShelfTypes,
	shelfIdByKey,
	shelfTypesByKey
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
import { linkDiff } from '$lib/documents/links';
import { deleteTag, upsertTag } from '$lib/server/tags';
import { loadTagsScreen } from '$lib/server/tags/screen';
import {
	archiveScopePredicate,
	assertVisibleDocument,
	visibleDocumentIds,
	visibleDocumentPredicate,
	NO_SUCH_DOCUMENT,
	type Actor
} from '$lib/server/documents/visibility';
import { searchDocuments } from '$lib/server/documents/search';
import { enqueueExtraction } from '$lib/server/documents/extract/queue';
import { runCpuQueue } from '$lib/server/jobs';
import type { Actions, PageServerLoad } from './$types';

/**
 * What the centre column draws: the list, the shelf's own layout, or Tags.
 *
 * The rail stays put whichever it is — a view is a thing the rail opens, not a
 * screen of its own.
 *
 * A SEARCH always falls back to the list: snippets are where a match is
 * explained, and a card face has nowhere to put a matched line of contents.
 * `?view=list` forces the list on any shelf, and is what the toolbar's own
 * switch writes, so the choice survives a reload and a shared link.
 */
function centreView(
	asked: string | null,
	query: string,
	layout: ShelfLayout | null
): 'tags' | 'list' | 'shelf' {
	if (asked === 'tags') return 'tags';
	if (asked === 'list' || query) return 'list';
	return layout && layout !== 'list' ? 'shelf' : 'list';
}

/** A period whose end precedes its start. Not a period, and not a box to draw. */
const PERIOD_BACKWARDS = Symbol('period backwards');

/**
 * The months a document says it covers, snapped to whole ones.
 *
 * Snapped and not stored verbatim, because that is what the columns MEAN:
 * `document_period_first_of_month` and its mirror have said so since before this
 * shelf existed, and the coverage ribbon works in whole months regardless. So a
 * person typing the 15th is saying "this month", and gets it — rather than a
 * constraint violation for answering the question as asked.
 *
 * An end with no start is dropped rather than refused: half an answer is a
 * person part-way through filling the pair in, not an error worth a red banner.
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
 * `accounts` and `gaps` are facts about COVERAGE — which months are accounted
 * for — and `shelf-stats` counts document rows. Answering them there would have
 * meant a second reading of what a gap is, so they are filled from the coverage
 * loader that already knows.
 */
async function bannerFactsFor(shelfKey: string, viewer: Actor | null) {
	const facts = await shelfFacts(shelfKey, viewer);
	if (shelfKey !== 'statements') return facts;
	const today = bannerToday();
	return {
		...facts,
		accounts: await coverageAccountCount(),
		gaps: await gapsAcrossYears(today)
	};
}

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
	const profile = shelfProfile(shelf);
	const view = centreView(url.searchParams.get('view'), query, profile?.layout ?? null);
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
		{ docs, railCounts, everywhereCount, docLinks, docTags, tags, texts, pending, identities },
		shelves,
		subjects,
		pickableTargets,
		shelfTypes,
		documentTypes
	] = await Promise.all([
		readDocumentsScreen({ readable, readableEverywhere }),
		listShelves(),
		// Behind the same read rule as everything else on this screen: a member
		// seeing "3" beside the car has been told about a document they cannot
		// open. The archive scope is deliberately NOT applied to these counts —
		// see `listSubjects`.
		listSubjects(db, locals.person),
		// The kinds the document side may pick, from the registry — which is the
		// one list. Whole, because a picker is a list of what could be chosen.
		// The four hand-written selects this replaces were the reason a receipt's
		// transaction had no name and an ordinary bank account had no chip: one of
		// them asked for brokerage accounts only, because one screen once did.
		// (Names for what the documents point at are read below, by id.)
		loadPickableTargets(),
		shelfTypesByKey(),
		listDocumentTypes()
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
	const identityByDoc = new Map(identities.map((row) => [row.documentId, row]));

	/** The two identity fields a row may show, or null when it has none. */
	const identityFor = (documentId: string) => {
		const row = identityByDoc.get(documentId);
		return row ? { kind: row.kind, country: row.country } : null;
	};

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
		// What the shelf expects first, then by how many documents each would
		// leave: opening Identity's type filter should start with Identity
		// document rather than with whatever happens to be most numerous.
		types: orderTypeOptions(
			[...typeCounts.entries()].map(([code, n]) => ({ code, count: n })),
			// The household's own list, which the registry only seeded.
			shelfTypes.get(shelf) ?? []
		),
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
			// The same links the row already carries by name, with the id and the
			// kind a layout groups by. Named separately from `entities` because
			// that one is a sub-line and this one is a section header: the list
			// wants "Robert, Vinohrady flat" and the wallet wants to know which of
			// those two is the person.
			about: (targetsByDoc.get(d.id) ?? []).map(({ id, kind, name }) => ({ id, kind, name })),
			tags: tagsByDoc.get(d.id) ?? [],
			addedOn: d.addedOn,
			periodOn: d.periodOn,
			periodEndOn: d.periodEndOn,
			expiresOn: d.expiresOn,
			expiryVerb: d.expiryVerb,
			subjectArchived: archivedByDoc.has(d.id),
			// What a wallet card draws: the kind it calls itself and the country
			// whose artwork it is on. The document NUMBER is deliberately absent —
			// a card face is glanced at with other people in the room, and a field
			// that never reaches the browser cannot be read off a screen.
			identity: identityFor(d.id),
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
		// The shelf's own default, so Finance opens by year and Identity by who it
		// is about; the control still nulls the parameter at whatever the shelf
		// would have done on its own.
		group: url.searchParams.get('group') ?? profile?.group ?? 'type',
		defaultGroup: profile?.group ?? 'type',
		// Every kind of paper this household files, built-in and its own. Drawn
		// from here rather than from the enum, which is only what ships.
		documentTypes,
		/** The layout being drawn, or null whenever the centre column is the list. */
		layout: view === 'shelf' ? (profile?.layout ?? null) : null,
		/** What this shelf COULD draw, so the toolbar can offer the switch. */
		shelfLayout: profile?.layout ?? null,
		emptyHint: profile?.emptyHint ?? null,
		/**
		 * The three figures the banner shows, or null where there is no one shelf
		 * to describe: "Everything" is not a shelf, and a result set is not one
		 * either — a banner over search results would be describing the shelf you
		 * left rather than what is on screen.
		 */
		bannerFacts:
			shelf === 'all' || query ? null : await bannerFactsFor(shelf, locals.person ?? null),
		/**
		 * The organisations the household deals with, for the rail's third
		 * section. Counted behind the same read rule as everything else here.
		 */
		organisations: await listOrganisations(db, locals.person ?? null),
		/** The counterparty cards, or null when the centre column draws the list. */
		counterparties:
			view === 'shelf' && profile?.layout === 'counterparties'
				? await loadCounterparties(
						Number(url.searchParams.get('year')) || Number(bannerToday().slice(0, 4)),
						bannerToday(),
						db,
						locals.person ?? null
					)
				: null,
		/**
		 * The ribbon, or null whenever it is not what the centre column draws —
		 * the list is one press away and does not need this payload.
		 */
		coverage:
			view === 'shelf' && profile?.layout === 'completeness'
				? await loadCoverage(
						Number(url.searchParams.get('year')) || Number(bannerToday().slice(0, 4)),
						bannerToday(),
						undefined,
						Number(url.searchParams.get('decade')) || undefined
					)
				: null,
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
				emoji: '',
				// Everything is a view of all the shelves rather than one of them,
				// so it has no list of its own to offer or to edit. Typed, so the
				// rail's editor sees one shape of `types` across every shelf.
				types: [] as DocumentTypeKey[]
			},
			...shelves.map((s) => ({
				id: s.id,
				key: s.key,
				label: s.label,
				emoji: s.emoji,
				system: s.system,
				count: shelfCounts.get(s.key) ?? 0,
				// The rail's type editor reads this; the filter above uses the same
				// rows, so what a shelf offers is stated once.
				types: shelfTypes.get(s.key) ?? []
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
					// The inspector is the one place the number is shown, and it is
					// masked there until asked for. Sent for every selected document,
					// not only for identity ones: a document retyped away from
					// `id_document` keeps its fields, and the screen decides whether
					// to draw them from the type it is currently showing.
					identityDetail: identityByDoc.get(selected.id) ?? null,
					// Inspector-only, like the number they sit beside: a card face
					// never shows one, so no row on the shelf needs to carry them.
					identityNumbers: await identityNumbersFor(selected.id),
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
			type: asDocumentType(form.get('type'), await documentTypeKeys()),
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
		// The read rule is a rule about the document, not about the list it was
		// read from. An id posted straight at this action has been through no
		// list at all, so the question is asked here before anything is written.
		const readable = await assertVisibleDocument(id, locals.person ?? null);
		if (!readable.ok) return fail(readable.status, { message: readable.message });

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
					...period,
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

			// The identity fields, when this is the kind of paper that has them.
			//
			// Written only for `id_document`, and never cleared for anything else:
			// a document retyped to Other keeps what somebody typed off its face,
			// so a mis-set dropdown costs a click rather than five fields. The
			// screen stops showing them, which is the whole of what "not an
			// identity document any more" means here.
			if (type === 'id_document') {
				await upsertIdentity(id, readIdentityFields(form), tx);
				// After the upsert, never before: the rows hang off the identity
				// record, so writing them first would have nothing to hang from on a
				// document being given its identity fields for the first time.
				await replaceIdentityNumbers(id, readIdentityNumbers(form), tx);
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
	replaceFile: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		const file = form.get('file');
		if (!id) return fail(400, { message: 'Which document?' });
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: 'Choose a file to put in its place.' });
		}
		// Before the upload is saved, not after: this is the sharpest of the
		// actions — different bytes behind a record somebody cannot see — and a
		// refusal that had already written a file would leave litter behind it.
		const readable = await assertVisibleDocument(id, locals.person ?? null);
		if (!readable.ok) return fail(readable.status, { message: readable.message });
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
	continueExtraction: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { message: 'Which document?' });
		// Reading more of a document is a read, and the queue would put its text
		// where search can find it.
		const readable = await assertVisibleDocument(id, locals.person ?? null);
		if (!readable.ok) return fail(readable.status, { message: readable.message });
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
		const selected = form.getAll('ids').map(String).filter(Boolean);
		if (selected.length === 0) return fail(400, { message: 'Nothing was selected.' });
		// Narrowed to what this person may act on, and the rest is simply not
		// there. Refusing the whole bar over one id would say that id is special,
		// which is the fact the read rule exists to keep quiet.
		const ids = await visibleDocumentIds(selected, locals.person ?? null);
		if (ids.length === 0) return fail(404, { message: NO_SUCH_DOCUMENT });

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
		const normalisedType = type ? asDocumentType(type, await documentTypeKeys()) : '';
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

	/**
	 * Which types a shelf offers first.
	 *
	 * A list, never a rule: the picker gets shorter and nothing gets refused, so
	 * an unticked type is still filed the moment somebody chooses it. Allowed on
	 * a system shelf too — what Identity holds cannot be deleted, and what it
	 * suggests is the household's business.
	 */
	setShelfTypes: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { message: 'Which shelf?' });
		// Filtered against what this household HAS, not against what the app
		// ships: filtering on the enum silently dropped every type the household
		// had added — the checkbox ticked, the form posted it, and the shelf came
		// back without it. The foreign key would otherwise refuse the write with
		// a constraint name nobody should have to read.
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
	 *
	 * Idempotent by key, so adding one that already exists selects it rather
	 * than refusing: two people naming the same thing have agreed.
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

	addOrganisation: async ({ request }) => {
		const form = await request.formData();
		try {
			await addOrganisation(
				{
					name: String(form.get('name') ?? ''),
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
