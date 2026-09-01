// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Income & Tax shelf as counterparty cards.
 *
 * One card per organisation, holding lanes, holding cells. A lane is the same
 * coverage question the Statements ribbon asks — which periods have nothing in
 * them — pointed at a different set of documents, so the arithmetic is
 * `$lib/statements/coverage` reused rather than a second reading of what a gap
 * is.
 *
 * What a lane EXPECTS is bounded by the engagement, not by the paper: a lane
 * counts from when the household's dealings with the organisation began, so a
 * year before the first filed document still reads as missing. That is the
 * whole reason role periods exist.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { document, documentLink, documentType, shelf, tag, tagLink } from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from '$lib/server/documents/visibility';
import { matchesLane, type LaneCandidate } from '$lib/organisations/lane-match';
import {
	coverageDecade,
	coverageRow,
	countGaps,
	decadeStart,
	type CoverageBox
} from '$lib/statements/coverage';
import { currentRole, engagementSpan, engagementsFor } from './engagements';
import { lanesFor, listOrganisations, type LaneRow } from './mutations';

export interface CardDocument {
	id: string;
	name: string;
	ext: string;
	typeLabel: string;
	addedOn: string;
	periodOn: string | null;
	periodEndOn: string | null;
}

/**
 * A document as a card shows it, without what only the matcher reads.
 *
 * `type` and `tags` are how a lane decides whether it holds the document; they
 * are not what the card draws, and sending them to the browser would put the
 * matching vocabulary on a screen that has no use for it.
 */
const asCardDocument = (doc: CardDocument & LaneCandidate): CardDocument => ({
	id: doc.id,
	name: doc.name,
	ext: doc.ext,
	typeLabel: doc.typeLabel,
	addedOn: doc.addedOn,
	periodOn: doc.periodOn,
	periodEndOn: doc.periodEndOn
});

export interface CardLane {
	id: string;
	label: string;
	cadence: 'monthly' | 'yearly' | 'none';
	/** Cells, for a lane with a cadence. Empty for `none`. */
	boxes: CoverageBox[];
	/** The documents themselves, for a `none` lane's list. */
	documents: CardDocument[];
	filed: number;
	expected: number;
	gaps: number;
}

export interface CounterpartyCard {
	id: string;
	name: string;
	kind: string;
	emoji: string;
	documentCount: number;
	/** "Research scientist", or null once every role period has closed. */
	role: string | null;
	/** When the household's dealings began — the earliest role period. */
	since: string | null;
	lanes: CardLane[];
	/** Filed against this organisation and claimed by no lane. Never hidden. */
	unclaimed: CardDocument[];
}

export interface CounterpartiesPayload {
	year: number;
	firstYear: number;
	lastYear: number;
	cards: CounterpartyCard[];
	documents: Record<string, CardDocument>;
}

/**
 * How many periods a lane expected, and how many it has.
 *
 * Expected counts from the engagement's start to the current period INCLUSIVE,
 * because the current one is not missing — it is `not-arrived-yet`, the same
 * rule the coverage ribbon applies. A lane with no start expects only what it
 * holds: an organisation nobody has dated cannot be behind.
 */
function expectedPeriods(
	cadence: 'monthly' | 'yearly',
	since: string | null,
	today: string,
	filed: number
): number {
	if (!since) return filed;
	if (cadence === 'yearly') {
		return Math.max(1, Number(today.slice(0, 4)) - Number(since.slice(0, 4)) + 1);
	}
	const months =
		(Number(today.slice(0, 4)) - Number(since.slice(0, 4))) * 12 +
		(Number(today.slice(5, 7)) - Number(since.slice(5, 7))) +
		1;
	return Math.max(1, months);
}

/** Every document filed against these organisations, with what a lane reads. */
async function documentsByOrganisation(
	organisationIds: string[],
	actor: Actor | null,
	handle: Queryable
): Promise<Map<string, (CardDocument & LaneCandidate)[]>> {
	if (organisationIds.length === 0) return new Map();

	const rows = await handle
		.select({
			organisationId: documentLink.targetId,
			id: document.id,
			name: document.name,
			ext: document.ext,
			type: document.type,
			typeLabel: documentType.label,
			addedOn: document.addedOn,
			periodOn: document.periodOn,
			periodEndOn: document.periodEndOn
		})
		.from(documentLink)
		.innerJoin(document, eq(document.id, documentLink.documentId))
		.innerJoin(documentType, eq(documentType.key, document.type))
		.where(and(inArray(documentLink.targetId, organisationIds), visibleDocumentPredicate(actor)));

	// Tags in one pass rather than per document: a lane may match on one, and a
	// card with forty payslips must not cost forty queries to find out.
	const tagRows =
		rows.length === 0
			? []
			: await handle
					.select({ documentId: tagLink.targetId, name: tag.name })
					.from(tagLink)
					.innerJoin(tag, eq(tag.id, tagLink.tagId))
					.where(
						inArray(
							tagLink.targetId,
							rows.map((r) => r.id)
						)
					);
	const tagsByDocument = new Map<string, string[]>();
	for (const row of tagRows) {
		tagsByDocument.set(row.documentId, [...(tagsByDocument.get(row.documentId) ?? []), row.name]);
	}

	const byOrganisation = new Map<string, (CardDocument & LaneCandidate)[]>();
	for (const row of rows) {
		const list = byOrganisation.get(row.organisationId) ?? [];
		list.push({ ...row, tags: tagsByDocument.get(row.id) ?? [] });
		byOrganisation.set(row.organisationId, list);
	}
	return byOrganisation;
}

/** One lane, drawn. */
function buildLane(
	laneRow: LaneRow,
	held: (CardDocument & LaneCandidate)[],
	since: string | null,
	year: number,
	today: string
): CardLane {
	const cadence = laneRow.cadence as 'monthly' | 'yearly' | 'none';
	const base = {
		id: laneRow.id,
		label: laneRow.label,
		cadence,
		documents: held.map(asCardDocument)
	};

	if (cadence === 'none') {
		// No cells: paper with no rhythm has nothing to be missing FROM, and a
		// grid drawn over it would invent an expectation nobody stated.
		return { ...base, boxes: [], filed: held.length, expected: held.length, gaps: 0 };
	}

	// Only dated documents can occupy a cell. An undated one still counts as
	// filed and still lists — it is held, it simply cannot be placed.
	const dated = held.filter((doc) => doc.periodOn !== null);
	const statements = dated.map((doc) => ({
		id: doc.id,
		periodOn: doc.periodOn as string,
		periodEndOn: doc.periodEndOn
	}));
	const evidence = since ?? dated.map((d) => d.periodOn as string).sort()[0] ?? null;

	const boxes =
		cadence === 'monthly'
			? coverageRow(statements, year, evidence, today)
			: coverageDecade(statements, decadeStart(year), evidence, today);

	return {
		...base,
		boxes,
		filed: held.length,
		expected: expectedPeriods(cadence, evidence, today, held.length),
		gaps: countGaps(boxes)
	};
}

/**
 * Every counterparty the shelf draws.
 *
 * An organisation with neither a lane nor a document filed against it is left
 * out: a card of empty lanes for a record somebody created and never used is
 * noise, and the record is still in the rail.
 */
export async function loadCounterparties(
	year: number,
	today: string,
	handle: Queryable = db,
	actor: Actor | null = null
): Promise<CounterpartiesPayload> {
	const organisations = await listOrganisations(handle, actor);
	const filedByOrg = await documentsByOrganisation(
		organisations.map((o) => o.id),
		actor,
		handle
	);

	const cards: CounterpartyCard[] = [];
	const documents: Record<string, CardDocument> = {};

	for (const org of organisations) {
		const laneRows = await lanesFor(org.id, handle);
		const held = filedByOrg.get(org.id) ?? [];
		if (laneRows.length === 0 && held.length === 0) continue;

		const roles = await engagementsFor(org.id, handle);
		const span = engagementSpan(roles);

		// First match wins, so a document cannot appear in two lanes and vanish
		// from the unclaimed count. The lanes are tried in `sortOrder`, which is
		// why a no-cadence lane matching everything belongs last.
		const claimed = new Set<string>();
		const lanes = laneRows.map((laneRow) => {
			const mine = held.filter(
				(doc) => !claimed.has(doc.id) && matchesLane(doc, laneRow.conditions)
			);
			for (const doc of mine) claimed.add(doc.id);
			return buildLane(laneRow, mine, span.startsOn, year, today);
		});

		for (const doc of held) documents[doc.id] = asCardDocument(doc);

		cards.push({
			id: org.id,
			name: org.name,
			kind: org.kind,
			emoji: org.emoji,
			documentCount: org.documentCount,
			role: currentRole(roles, today),
			since: span.startsOn,
			lanes,
			// Counted, never dropped — the invariant the coverage ribbon keeps in
			// the same words: everything on the shelf is either drawn here or
			// accounted for here.
			unclaimed: held.filter((doc) => !claimed.has(doc.id)).map(asCardDocument)
		});
	}

	const thisYear = Number(today.slice(0, 4));
	const starts = cards.map((c) => c.since).filter((day): day is string => day !== null);
	return {
		year,
		firstYear: starts.length > 0 ? Number(starts.sort()[0].slice(0, 4)) : thisYear,
		lastYear: thisYear,
		cards,
		documents
	};
}

/** Kept for the shelf's own guard: the shelf key these cards belong to. */
export async function counterpartyShelfHasPaper(handle: Queryable = db): Promise<boolean> {
	const [row] = await handle
		.select({ n: sql<number>`count(*)::int` })
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.where(eq(shelf.key, 'finance'));
	return (row?.n ?? 0) > 0;
}
