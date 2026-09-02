// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a dossier shelf draws: one card per unit, with its lanes and its history.
 *
 * Generalised in v0.8.0 from `counterparties-load`, which drew this for
 * organisations alone because Income & Tax was the only shelf with lanes. A
 * car's road tax and a flat's boiler inspection are the same shape, so the
 * cards come from whatever the shelf's `unit` says and the lanes hang off the
 * entity supertype.
 *
 * Two things changed besides the generalisation, and both are rulings rather
 * than refactors:
 *
 * - **Membership is `document.lane_id`, not a match.** `matchesLane` PROPOSES a
 *   lane and a person confirms it. Two lanes on one card can both match a
 *   payslip, and only the document itself can say which one holds it.
 * - **Paper that names no card is drawn, not dropped.** The last card on every
 *   dossier shelf is "Not assigned yet", which exists only when it has
 *   something in it. It is what makes filing to a shelf before its card exists
 *   a safe thing to do.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import {
	account,
	document,
	documentLink,
	documentType,
	organisation,
	person,
	property,
	shelf,
	subject
} from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from './visibility';
import {
	monthlyCells,
	onceCell,
	yearlyCells,
	type DossierCell
} from '$lib/documents/dossier-cells';
import { coverageRow } from '$lib/statements/coverage';
import { templateDefaults, unitMakesCards, type ShelfUnit } from '$lib/documents/templates';
import { currentRole, engagementSpan, engagementsFor } from '$lib/server/organisations/engagements';
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

export interface DossierCard {
	/** Null on the implicit "Not assigned yet" card, which has no record. */
	id: string | null;
	name: string;
	emoji: string;
	/** An organisation's kind, or the unit's own word. */
	kind: string;
	/** A relationship line: "Senior analytik · since 2022", or null. */
	meta: string | null;
	/** The document the relationship rests on, where there is one. */
	pinned: CardDocument | null;
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
			return rows.map((r) => ({ ...r, emoji: UNIT_EMOJI.person, kind: 'person', since: null }));
		}
		case 'property': {
			const rows = await handle
				.select({ id: property.id, name: property.name })
				.from(property)
				.orderBy(property.name);
			return rows.map((r) => ({ ...r, emoji: UNIT_EMOJI.property, kind: 'property', since: null }));
		}
		case 'account': {
			const rows = await handle
				.select({ id: account.id, name: account.name })
				.from(account)
				.orderBy(account.name);
			return rows.map((r) => ({ ...r, emoji: UNIT_EMOJI.account, kind: 'account', since: null }));
		}
		case 'organisation': {
			const rows = await handle
				.select({
					id: organisation.id,
					name: organisation.name,
					emoji: organisation.emoji,
					kind: organisation.kind
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
			return rows.map((r) => ({ ...r, kind: 'subject' }));
		}
		default:
			return [];
	}
}

/** Every document on the shelf the viewer may see, with the card it names. */
async function shelfDocuments(
	shelfRow: ShelfRow,
	cardIds: string[],
	actor: Actor | null,
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
			laneId: document.laneId
		})
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.innerJoin(documentType, eq(documentType.key, document.type))
		.where(and(eq(shelf.id, shelfRow.id), visibleDocumentPredicate(actor)));

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
			laneId: row.laneId
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

/** One lane, drawn. */
function buildLane(
	laneRow: LaneRow,
	held: CardDocument[],
	personName: string | null,
	since: string | null,
	year: number,
	today: string
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
				today
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
		cells = yearlyCells({
			filedYears,
			firstYear,
			lastYear: thisYear,
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
	actor: Actor | null,
	year: number,
	handle: Queryable = db,
	today: string = new Date().toISOString().slice(0, 10)
): Promise<DossierPayload> {
	const records = await cardsFor(shelfRow, handle);
	const { byCard, loose } = await shelfDocuments(
		shelfRow,
		records.map((r) => r.id),
		actor,
		handle
	);
	const { historyOrder } = templateDefaults(shelfRow.template);

	const people = new Map(
		(await handle.select({ id: person.id, name: person.name }).from(person)).map((p) => [
			p.id,
			p.name
		])
	);

	const cards: DossierCard[] = [];
	for (const record of records) {
		const held = byCard.get(record.id) ?? [];
		const laneRows = await lanesFor(record.id, handle);

		// An organisation's relationship line and bound come from its engagements;
		// a subject's from its own active period. Both answer the same question —
		// when did we start expecting paper — which is what a lane needs.
		let since = record.since;
		let meta: string | null = null;
		let pinned: CardDocument | null = null;
		if (record.kind !== 'person' && record.kind !== 'property' && record.kind !== 'account') {
			const roles = await engagementsFor(record.id, handle);
			if (roles.length > 0) {
				const span = engagementSpan(roles);
				since = span.startsOn ?? since;
				const role = currentRole(roles, today);
				meta = [role, since ? `since ${since.slice(0, 4)}` : null].filter(Boolean).join(' · ');
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
		const lanes = laneRows.map((laneRow) => {
			const mine = held.filter((doc) => doc.laneId === laneRow.id);
			for (const doc of mine) inLane.add(doc.id);
			return buildLane(
				laneRow,
				mine,
				laneRow.personId ? (people.get(laneRow.personId) ?? null) : null,
				since,
				year,
				today
			);
		});

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

		const lapsed = held.filter((d) => d.expiresOn !== null && d.expiresOn < today).length;
		cards.push({
			id: record.id,
			name: record.name,
			emoji: record.emoji,
			kind: record.kind,
			meta,
			pinned,
			lanes,
			history,
			documentCount: held.length,
			findings: lanes.reduce((n, lane) => n + lane.gaps, 0) + lapsed
		});
	}

	// Findings first, then by how much paper a card holds: the card with a hole
	// in it is what the shelf exists to show, and the busiest card is what a
	// person is most likely to be looking for.
	cards.sort(
		(a, b) =>
			b.findings - a.findings || b.documentCount - a.documentCount || a.name.localeCompare(b.name)
	);

	// Last, and only when it holds something.
	if (loose.length > 0) {
		cards.push({
			id: null,
			name: 'Not assigned yet',
			emoji: '📎',
			kind: shelfRow.unit,
			meta: null,
			pinned: null,
			lanes: [],
			history: loose.sort((a, b) =>
				(b.periodOn ?? b.addedOn).localeCompare(a.periodOn ?? a.addedOn)
			),
			documentCount: loose.length,
			findings: 0
		});
	}

	const thisYear = Number(today.slice(0, 4));
	const firstYears = cards
		.flatMap((c) => c.lanes.flatMap((l) => l.cells.map((cell) => Number(cell.key.slice(0, 4)))))
		.filter((n) => Number.isFinite(n));
	return {
		year,
		firstYear: firstYears.length > 0 ? Math.min(...firstYears) : thisYear,
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

/** Whether a dossier shelf has any paper at all, for its empty state. */
export async function dossierShelfHasPaper(
	shelfRow: ShelfRow,
	handle: Queryable = db
): Promise<boolean> {
	const [row] = await handle
		.select({ n: sql<number>`count(*)::int` })
		.from(document)
		.where(eq(document.shelfId, shelfRow.id));
	return (row?.n ?? 0) > 0;
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
