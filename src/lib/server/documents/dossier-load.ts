// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a dossier shelf draws: one card per unit, with its lanes and its history.
 *
 * A car's road tax and a flat's boiler inspection are the same shape as an
 * organisation's filings, so cards come from whatever the shelf's `unit` says
 * and lanes hang off the entity supertype rather than being organisation-only.
 *
 * Two rulings worth stating:
 *
 * - **Membership is `document.lane_id`, not a match.** `matchesLane` PROPOSES a
 *   lane and a person confirms it. Two lanes on one card can both match a
 *   payslip, and only the document itself can say which one holds it.
 * - **Paper that names no card is drawn, not dropped.** The last card on every
 *   dossier shelf is "Not assigned yet", which exists only when it has
 *   something in it. It is what makes filing to a shelf before its card exists
 *   a safe thing to do.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import {
	account,
	document,
	documentLink,
	documentType,
	loan,
	organisation,
	person,
	property,
	shelf,
	subject
} from '$lib/server/db/schema';
import {
	monthlyCells,
	onceCell,
	yearlyCells,
	type DossierCell
} from '$lib/documents/dossier-cells';
import { coverageRow } from '$lib/statements/coverage';
import { templateDefaults, unitMakesCards, type ShelfUnit } from '$lib/documents/templates';
import {
	currentEngagement,
	engagementSpan,
	engagementsFor
} from '$lib/server/organisations/engagements';
import { lanesFor, type LaneRow } from '$lib/server/organisations/mutations';
import type { ShelfRow } from './shelves';

export interface CardDocument {
	id: string;
	name: string;
	ext: string;
	typeLabel: string;
	addedOn: string;
	periodOn: string | null;
	periodEndOn: string | null;
	expiresOn: string | null;
	laneId: string | null;
	/**
	 * The tax year card this document already sits on, or null.
	 *
	 * Paper with a year and a country is placed — a return or the report behind
	 * one — whether or not it names an employer. Under "Not assigned yet" it is
	 * a link to where it lives, not an orphan.
	 */
	onTaxYear: { year: number; country: string } | null;
}

export interface DossierLane {
	id: string;
	label: string;
	cadence: LaneRow['cadence'];
	/** For `yearly`: a cell every N years. */
	every: number;
	/** Null for a lane about the card rather than about one person. */
	personName: string | null;
	cells: DossierCell[];
	filed: number;
	/** How many cells could hold something: filed plus gaps. */
	expected: number;
	gaps: number;
	documents: CardDocument[];
}

export interface DossierCardRole {
	id: string;
	personId: string;
	personName: string;
	role: string | null;
	startsOn: string | null;
	endsOn: string | null;
}

export interface DossierCard {
	/** Null on the implicit "Not assigned yet" card, which has no record. */
	id: string | null;
	name: string;
	emoji: string;
	/** An organisation's kind, or the unit's own word. */
	kind: string;
	/** An organisation's country, where the household has said. Null elsewhere. */
	country: string | null;
	/** A relationship line: "Senior analytik · since 2022", or null. */
	meta: string | null;
	/** The document the relationship rests on, where there is one. */
	pinned: CardDocument | null;
	/** Every role period on this card, oldest first. Empty off an organisation shelf. */
	roles: DossierCardRole[];
	lanes: DossierLane[];
	/** Paper with no rhythm, in the template's order. */
	history: CardDocument[];
	documentCount: number;
	/** Gaps, empty slots and lapsed paper. What sorts a card to the top. */
	findings: number;
}

export interface DossierPayload {
	year: number;
	firstYear: number;
	lastYear: number;
	historyOrder: 'newest' | 'oldest';
	unit: ShelfUnit;
	/** Whether "New card" is offered: only a subject or an organisation is made here. */
	canCreate: boolean;
	cards: DossierCard[];
}

/** One card's record, before anything is filed against it. */
interface CardRecord {
	id: string;
	name: string;
	emoji: string;
	kind: string;
	/** Organisations only: which country it is in, or null. */
	country: string | null;
	/** When the relationship began, where the record says. */
	since: string | null;
}

const UNIT_EMOJI: Record<string, string> = {
	person: '👤',
	property: '🏠',
	account: '🏦',
	subject: '📦',
	organisation: '🏛️'
};

/**
 * The records a shelf draws a card for.
 *
 * People and properties draw one each whether or not anything is filed against
 * them — a flat with no paperwork yet is still a flat the shelf is for, and a
 * member with no health record is the finding. Subjects and organisations are
 * homed on the shelf, so only that shelf's own appear.
 */
async function cardsFor(shelfRow: ShelfRow, handle: Queryable): Promise<CardRecord[]> {
	switch (shelfRow.unit) {
		case 'person': {
			const rows = await handle
				.select({ id: person.id, name: person.name })
				.from(person)
				.orderBy(person.name);
			return rows.map((r) => ({
				...r,
				emoji: UNIT_EMOJI.person,
				kind: 'person',
				country: null,
				since: null
			}));
		}
		case 'property': {
			const rows = await handle
				.select({ id: property.id, name: property.name })
				.from(property)
				.orderBy(property.name);
			return rows.map((r) => ({
				...r,
				emoji: UNIT_EMOJI.property,
				kind: 'property',
				country: null,
				since: null
			}));
		}
		case 'account': {
			// An account OR a loan: `unit: 'account'` means anything a bank numbers
			// and sends statements about, so a mortgage statement has a card of its
			// own rather than living out its life under "Not assigned yet". See the
			// note on `shelf.unit` in `$lib/enums`.
			const [accounts, loans] = await Promise.all([
				handle.select({ id: account.id, name: account.name }).from(account).orderBy(account.name),
				handle.select({ id: loan.id, name: loan.name }).from(loan).orderBy(loan.name)
			]);
			return [...accounts, ...loans].map((r) => ({
				...r,
				emoji: UNIT_EMOJI.account,
				kind: 'account',
				country: null,
				since: null
			}));
		}
		case 'organisation': {
			const rows = await handle
				.select({
					id: organisation.id,
					name: organisation.name,
					emoji: organisation.emoji,
					kind: organisation.kind,
					country: organisation.country
				})
				.from(organisation)
				.where(eq(organisation.shelfId, shelfRow.id))
				.orderBy(organisation.name);
			return rows.map((r) => ({ ...r, since: null }));
		}
		case 'subject': {
			const rows = await handle
				.select({
					id: subject.id,
					name: subject.name,
					emoji: subject.emoji,
					since: subject.activeFrom
				})
				.from(subject)
				.where(and(eq(subject.shelfId, shelfRow.id), isNull(subject.archivedAt)))
				.orderBy(subject.name);
			return rows.map((r) => ({ ...r, kind: 'subject', country: null }));
		}
		default:
			return [];
	}
}

/** Every document on the shelf, with the card it names. */
async function shelfDocuments(
	shelfRow: ShelfRow,
	cardIds: string[],
	handle: Queryable
): Promise<{ byCard: Map<string, CardDocument[]>; loose: CardDocument[] }> {
	const rows = await handle
		.select({
			id: document.id,
			name: document.name,
			ext: document.ext,
			typeLabel: documentType.label,
			type: document.type,
			addedOn: document.addedOn,
			periodOn: document.periodOn,
			periodEndOn: document.periodEndOn,
			expiresOn: document.expiresOn,
			laneId: document.laneId,
			country: document.country
		})
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.innerJoin(documentType, eq(documentType.key, document.type))
		.where(eq(shelf.id, shelfRow.id));

	// Which card each document names. One pass rather than a query per card: a
	// shelf with forty cards must not cost forty round trips to draw.
	const links =
		rows.length === 0 || cardIds.length === 0
			? []
			: await handle
					.select({ documentId: documentLink.documentId, targetId: documentLink.targetId })
					.from(documentLink)
					.where(
						and(
							inArray(
								documentLink.documentId,
								rows.map((r) => r.id)
							),
							inArray(documentLink.targetId, cardIds)
						)
					);

	const cardOf = new Map<string, string[]>();
	for (const link of links)
		cardOf.set(link.documentId, [...(cardOf.get(link.documentId) ?? []), link.targetId]);

	const byCard = new Map<string, CardDocument[]>();
	const loose: CardDocument[] = [];
	for (const row of rows) {
		const doc: CardDocument = {
			id: row.id,
			name: row.name,
			ext: row.ext,
			typeLabel: row.typeLabel,
			addedOn: row.addedOn,
			periodOn: row.periodOn,
			periodEndOn: row.periodEndOn,
			expiresOn: row.expiresOn,
			laneId: row.laneId,
			onTaxYear:
				row.country && row.periodOn
					? { year: Number(row.periodOn.slice(0, 4)), country: row.country }
					: null
		};
		const cards = cardOf.get(row.id);
		if (!cards || cards.length === 0) {
			// Named no card on this shelf. Drawn under "Not assigned yet" rather
			// than dropped: everything on the shelf is either on a card or
			// accounted for at the end of it.
			loose.push(doc);
			continue;
		}
		// A document about two cards appears on both. That is the honest drawing:
		// a lease naming a flat and a tenant belongs to each of them.
		for (const cardId of cards) byCard.set(cardId, [...(byCard.get(cardId) ?? []), doc]);
	}
	return { byCard, loose };
}

/** Every role period on the card has closed — same rule as `engagementSpan`. */
function cardEnded(card: DossierCard): boolean {
	return card.roles.length > 0 && card.roles.every((r) => r.endsOn !== null);
}

/**
 * The date an organisation card sorts by: the latest of every start and end
 * its role periods carry. For a job still held that is its start (there is no
 * end yet); for one left it is the day it ended, which is later than when it
 * began. One rule reads both.
 */
function cardRecency(card: DossierCard): string {
	const dates = card.roles.flatMap((r) =>
		[r.startsOn, r.endsOn].filter((d): d is string => d !== null)
	);
	return dates.length > 0 ? [...dates].sort().pop()! : '';
}

/** One lane, drawn. */
function buildLane(
	laneRow: LaneRow,
	held: CardDocument[],
	personName: string | null,
	since: string | null,
	year: number,
	today: string,
	/**
	 * When a role period closed, its last day — monthly paper stops being
	 * expected the month after, so switching employer mid-year does not leave
	 * the one just left "missing" payslips nobody will ever send. Null while
	 * the relationship is still open, or for a card with no such notion.
	 * A yearly lane ignores it for the year it falls in — a declaration is
	 * still owed for a partial year worked, however early the relationship
	 * ended — but still caps its last drawn year there, so a job left in
	 * 2023 does not keep reading as a missing 2024 and 2025 declaration.
	 */
	until: string | null = null
): DossierLane {
	const base = {
		id: laneRow.id,
		label: laneRow.label,
		cadence: laneRow.cadence,
		every: laneRow.every,
		personName,
		documents: held,
		filed: held.length
	};

	if (laneRow.cadence === 'none') {
		// No cells: paper with no rhythm has nothing to be missing FROM, and a
		// grid drawn over it would invent an expectation nobody stated.
		return { ...base, cells: [], expected: held.length, gaps: 0 };
	}

	if (laneRow.cadence === 'once') {
		// A slot. One cell, and the empty one is the finding.
		const cell = onceCell(held.map((d) => d.id));
		return { ...base, cells: [cell], expected: 1, gaps: cell.state === 'gap' ? 1 : 0 };
	}

	// Only dated documents can occupy a cell. An undated one still counts as
	// filed and still lists — it is held, it simply cannot be placed.
	const dated = held.filter((doc) => doc.periodOn !== null);
	const evidence = since ?? dated.map((d) => d.periodOn as string).sort()[0] ?? null;
	const thisYear = Number(today.slice(0, 4));

	let cells: DossierCell[];
	if (laneRow.cadence === 'monthly') {
		cells = monthlyCells(
			coverageRow(
				dated.map((d) => ({
					id: d.id,
					periodOn: d.periodOn as string,
					periodEndOn: d.periodEndOn
				})),
				year,
				evidence,
				today,
				until
			),
			year
		);
	} else {
		const filedYears = new Map<number, string[]>();
		for (const doc of dated) {
			const y = Number((doc.periodOn as string).slice(0, 4));
			filedYears.set(y, [...(filedYears.get(y) ?? []), doc.id]);
		}
		// A window at a time, ending at the current year: the ribbon's decade is
		// the wrong frame for a lane that may run every two years from 2021.
		const earliest = evidence ? Number(evidence.slice(0, 4)) : thisYear;
		const firstYear = Math.min(earliest, ...[...filedYears.keys(), thisYear]);
		// A closed relationship still owes a declaration for the partial year it
		// ended in, but nothing after — capped at that year, not run to today.
		const lastYear = until ? Math.max(Number(until.slice(0, 4)), firstYear) : thisYear;
		cells = yearlyCells({
			filedYears,
			firstYear,
			lastYear,
			every: laneRow.every,
			firstEvidenceYear: evidence ? Number(evidence.slice(0, 4)) : null,
			thisYear
		});
	}

	const gaps = cells.filter((c) => c.state === 'gap').length;
	return {
		...base,
		cells,
		// What could hold something: what does, plus what should and does not. A
		// window still running is neither.
		expected: cells.filter((c) => c.state === 'filed' || c.state === 'gap').length,
		gaps
	};
}

/**
 * Every card the shelf draws, findings first.
 *
 * `year` chooses which year a monthly lane shows; a yearly lane always draws
 * from the relationship's beginning, because a card of five windows is short
 * enough to read whole and paging it would hide the very gap it exists to show.
 */
export async function loadDossier(
	shelfRow: ShelfRow,
	year: number,
	handle: Queryable = db,
	today: string = new Date().toISOString().slice(0, 10)
): Promise<DossierPayload> {
	const records = await cardsFor(shelfRow, handle);
	const { byCard, loose } = await shelfDocuments(
		shelfRow,
		records.map((r) => r.id),
		handle
	);
	const { historyOrder } = templateDefaults(shelfRow.template);

	const people = new Map(
		(await handle.select({ id: person.id, name: person.name }).from(person)).map((p) => [
			p.id,
			p.name
		])
	);

	const thisYear = Number(today.slice(0, 4));
	// How far back year navigation can go — the earliest a card's own relationship
	// started, or the earliest paper actually filed, whichever is earlier. NOT the
	// cells `buildLane` draws: those are generated fresh for whichever `year` is
	// currently on screen, so every cell key carries that same year regardless of
	// what is actually filed — computing the bound from them would always yield the
	// year already being viewed, permanently disabling "Previous year" the moment
	// any card has a monthly lane.
	let earliestYear = thisYear;

	const cards: DossierCard[] = [];
	for (const record of records) {
		const held = byCard.get(record.id) ?? [];
		const laneRows = await lanesFor(record.id, handle);

		// An organisation's relationship line and bound come from its engagements;
		// a subject's from its own active period. Both answer the same question —
		// when did we start expecting paper — which is what a lane needs.
		let since = record.since;
		// Set only when every role period on the card has closed — see
		// `engagementSpan`. A still-open period means the relationship
		// continues, so nothing bounds a monthly lane's far end.
		let until: string | null = null;
		let meta: string | null = null;
		let pinned: CardDocument | null = null;
		let cardRoles: DossierCardRole[] = [];
		if (record.kind !== 'person' && record.kind !== 'property' && record.kind !== 'account') {
			const roles = await engagementsFor(record.id, handle);
			cardRoles = roles.map((r) => ({
				id: r.id,
				personId: r.personId,
				personName: people.get(r.personId) ?? '',
				role: r.role,
				startsOn: r.startsOn,
				endsOn: r.endsOn
			}));
			if (roles.length > 0) {
				const span = engagementSpan(roles);
				since = span.startsOn ?? since;
				until = span.endsOn;
				// Whoever the card is currently for, or was for last — so a
				// household with more than one person can tell whose employer
				// this is without opening a payslip to read the name off it.
				const live = currentEngagement(roles, today);
				const relevant = live ?? roles[roles.length - 1];
				const personName = people.get(relevant.personId) ?? null;
				meta = [personName, live?.role ?? null, since ? `since ${since.slice(0, 4)}` : null]
					.filter(Boolean)
					.join(' · ');
				const pinnedId = roles.find((r) => r.documentId)?.documentId ?? null;
				pinned = held.find((d) => d.id === pinnedId) ?? null;
			}
		}
		// No engagement to point at one: the oldest contract on the card is what
		// the relationship rests on.
		if (!pinned) {
			pinned =
				held
					.filter((d) => d.typeLabel.toLowerCase() === 'contract')
					.sort((a, b) => (a.periodOn ?? a.addedOn).localeCompare(b.periodOn ?? b.addedOn))[0] ??
				null;
		}
		if (!meta && since) meta = `since ${since.slice(0, 4)}`;

		const inLane = new Set<string>();
		const builtLanes = laneRows.map((laneRow) => {
			const mine = held.filter((doc) => doc.laneId === laneRow.id);
			for (const doc of mine) inLane.add(doc.id);
			return buildLane(
				laneRow,
				mine,
				laneRow.personId ? (people.get(laneRow.personId) ?? null) : null,
				since,
				year,
				today,
				until
			);
		});
		// Nothing filed and nothing missing is nothing to say — for a SCHEDULE.
		// A seeded monthly or yearly lane a household never uses is not a blank
		// grid worth scrolling past; it simply does not draw until it has either.
		// A cadence-less lane is different: it is not tracking a schedule at
		// all, it is the card's one general place for paper that isn't a
		// payslip or a declaration, and hiding it the moment it empties out
		// would hide the only sign that place exists.
		const lanes = builtLanes.filter((l) => l.cadence === 'none' || l.filed > 0 || l.gaps > 0);

		// Everything not in a lane, plus everything in a lane with no rhythm.
		const history = held
			.filter(
				(doc) => !inLane.has(doc.id) || lanes.some((l) => l.id === doc.laneId && !l.cells.length)
			)
			.filter((doc) => doc.id !== pinned?.id)
			.sort((a, b) => {
				const left = a.periodOn ?? a.addedOn;
				const right = b.periodOn ?? b.addedOn;
				return historyOrder === 'newest' ? right.localeCompare(left) : left.localeCompare(right);
			});

		if (since) earliestYear = Math.min(earliestYear, Number(since.slice(0, 4)));
		for (const doc of held) {
			if (doc.periodOn) earliestYear = Math.min(earliestYear, Number(doc.periodOn.slice(0, 4)));
		}

		const lapsed = held.filter((d) => d.expiresOn !== null && d.expiresOn < today).length;
		cards.push({
			id: record.id,
			name: record.name,
			emoji: record.emoji,
			kind: record.kind,
			country: record.country,
			meta,
			pinned,
			roles: cardRoles,
			lanes,
			history,
			documentCount: held.length,
			findings: lanes.reduce((n, lane) => n + lane.gaps, 0) + lapsed
		});
	}

	if (shelfRow.unit === 'organisation') {
		// A household's own employment history, read the way it was lived: the
		// job it holds now (or has no recorded period for at all) above every
		// one it has left, and each of those two groups newest first. Findings
		// do not lead here — a gap in a job left three years ago is not more
		// urgent than knowing which employer is current.
		cards.sort(
			(a, b) =>
				Number(cardEnded(a)) - Number(cardEnded(b)) || cardRecency(b).localeCompare(cardRecency(a))
		);
	} else {
		// Findings first, then by how much paper a card holds: the card with a
		// hole in it is what the shelf exists to show, and the busiest card is
		// what a person is most likely to be looking for.
		cards.sort(
			(a, b) =>
				b.findings - a.findings || b.documentCount - a.documentCount || a.name.localeCompare(b.name)
		);
	}

	for (const doc of loose) {
		if (doc.periodOn) earliestYear = Math.min(earliestYear, Number(doc.periodOn.slice(0, 4)));
	}

	// Last, and only when it holds something.
	if (loose.length > 0) {
		cards.push({
			id: null,
			name: 'Not assigned yet',
			emoji: '📎',
			kind: shelfRow.unit,
			country: null,
			meta: null,
			pinned: null,
			roles: [],
			lanes: [],
			history: loose.sort((a, b) =>
				(b.periodOn ?? b.addedOn).localeCompare(a.periodOn ?? a.addedOn)
			),
			documentCount: loose.length,
			findings: 0
		});
	}

	return {
		year,
		firstYear: earliestYear,
		lastYear: thisYear,
		historyOrder,
		unit: shelfRow.unit,
		canCreate: unitMakesCards(shelfRow.unit),
		cards
	};
}

/** Gaps and empty slots across the shelf — the band's `missing` figure. */
export function dossierMissing(payload: DossierPayload): number {
	return payload.cards.filter((c) => c.id !== null).reduce((n, card) => n + card.findings, 0);
}

/** Re-exported so the queue can offer the same cards this draws. */
export { cardsFor, type CardRecord };

/**
 * The lanes of the card ONE document names, for the inspector's Lane picker.
 *
 * A lane belongs to one card, so a document naming no card on this shelf has
 * none to choose from — which is why the picker is absent rather than empty.
 */
export async function lanesForDocument(
	documentId: string,
	shelfRow: ShelfRow | null,
	handle: Queryable = db
): Promise<LaneRow[]> {
	if (!shelfRow) return [];
	const records = await cardsFor(shelfRow, handle);
	if (records.length === 0) return [];
	const ids = new Set(records.map((r) => r.id));
	const links = await handle
		.select({ targetId: documentLink.targetId })
		.from(documentLink)
		.where(eq(documentLink.documentId, documentId));
	const card = links.find((l) => ids.has(l.targetId));
	return card ? lanesFor(card.targetId, handle) : [];
}
