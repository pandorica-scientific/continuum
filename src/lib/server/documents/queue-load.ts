// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Inbox, as the queue it always was.
 *
 * v0.7.x had this on a screen of its own at `/documents/review`, reached by a
 * link. That made the Inbox two things: a shelf listing unfiled paper, and a
 * separate page for doing something about it — and the shelf could only ever
 * show you the problem. The Inbox IS the queue now, which is what "one
 * question, one unit, one template" means for a shelf whose unit is the
 * document itself.
 *
 * Filing takes three steps, and they are three because each narrows the next:
 * the shelf decides which cards exist, the card decides which lanes exist, and
 * the lane decides what type the paper probably is.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { document, shelf } from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from './visibility';
import { daysBetween } from '$lib/dates';
import { templateEngine, unitMakesCards, type ShelfEngine } from '$lib/documents/templates';
import { listShelves, shelfTypesByKey, type ShelfRow } from './shelves';
import { lanesFor } from '$lib/server/organisations/mutations';
import { cardsFor } from './dossier-load';
import { loadProposals } from '$lib/server/organisations/proposals-load';

export interface QueueDocument {
	id: string;
	name: string;
	ext: string;
	storedName: string | null;
	addedOn: string;
	/** How long it has waited, in whole days. */
	waitingDays: number;
}

export interface QueueCard {
	id: string;
	name: string;
	emoji: string;
}

export interface QueueLane {
	id: string;
	label: string;
	cadence: string;
	every: number;
	/**
	 * The type this lane's rule names, where it names one.
	 *
	 * A lane that says "type is payslip" is also saying what the paper in it is,
	 * so choosing the lane answers the type question too. Proposed, never
	 * imposed: the type select is still there and still editable.
	 */
	impliedType: string | null;
}

export interface QueueShelf {
	key: string;
	label: string;
	emoji: string;
	unit: string;
	engine: ShelfEngine;
	/** Whether a card can be made here on the way past. */
	canCreate: boolean;
	/** What this shelf offers first in the type picker. */
	types: string[];
}

export interface QueuePayload {
	waiting: QueueDocument[];
	/** The document being decided, or null when the queue is empty. */
	current: string | null;
	/** Its place in the queue, for "3 of 7". */
	index: number;
	shelves: QueueShelf[];
	/** Cards by shelf key. */
	cards: Record<string, QueueCard[]>;
	/** Lanes by card id. */
	lanes: Record<string, QueueLane[]>;
	/** What a lane rule thinks the current document is, where one matched. */
	proposal: {
		documentId: string;
		shelfKey: string;
		cardId: string;
		laneId: string;
		laneLabel: string;
		cardName: string;
	} | null;
}

/** The type a lane's first `type is X` condition names, or null. */
function impliedType(conditions: unknown): string | null {
	if (!Array.isArray(conditions)) return null;
	for (const raw of conditions) {
		const condition = raw as { field?: unknown; op?: unknown; value?: unknown };
		if (condition.field === 'type' && condition.op === 'is' && typeof condition.value === 'string')
			return condition.value;
	}
	return null;
}

export async function loadQueue(
	actor: Actor | null,
	handle: Queryable = db,
	today: string = new Date().toISOString().slice(0, 10),
	openId = ''
): Promise<QueuePayload> {
	const shelves = await listShelves(handle);
	const inbox = shelves.find((s) => templateEngine(s.template) === 'queue');
	if (!inbox)
		return {
			waiting: [],
			current: null,
			index: 0,
			shelves: [],
			cards: {},
			lanes: {},
			proposal: null
		};

	const rows = await handle
		.select({
			id: document.id,
			name: document.name,
			ext: document.ext,
			storedName: document.storedName,
			addedOn: document.addedOn
		})
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.where(and(eq(shelf.id, inbox.id), visibleDocumentPredicate(actor)))
		// Oldest first. A queue that offered the newest would leave the one that
		// has waited longest waiting longer.
		.orderBy(asc(document.addedOn), asc(document.id));

	const waiting: QueueDocument[] = rows.map((row) => ({
		...row,
		waitingDays: daysBetween(row.addedOn, today)
	}));

	// `?doc=` when it is still in the queue, so a link to one document opens it;
	// otherwise the oldest, which is what the queue is for.
	const index = Math.max(
		0,
		waiting.findIndex((d) => d.id === openId)
	);
	const current = waiting[index]?.id ?? null;

	// Every shelf but the Inbox, with what a card on it would be.
	const filing: ShelfRow[] = shelves.filter((s) => s.id !== inbox.id && s.key !== 'all');
	const offered = await shelfTypesByKey(handle);
	const queueShelves: QueueShelf[] = filing.map((s) => ({
		key: s.key,
		label: s.label,
		emoji: s.emoji,
		unit: s.unit,
		engine: templateEngine(s.template),
		canCreate: unitMakesCards(s.unit),
		types: offered.get(s.key) ?? []
	}));

	const cards: Record<string, QueueCard[]> = {};
	const lanes: Record<string, QueueLane[]> = {};
	for (const row of filing) {
		const records = await cardsFor(row, handle);
		cards[row.key] = records.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji }));
		// Lanes only where the shelf draws them. A wallet and a ribbon have none,
		// and asking for them would be a query per person for nothing.
		if (templateEngine(row.template) !== 'dossier') continue;
		for (const record of records) {
			const laneRows = await lanesFor(record.id, handle);
			if (laneRows.length > 0)
				lanes[record.id] = laneRows.map((l) => ({
					id: l.id,
					label: l.label,
					cadence: l.cadence,
					every: l.every,
					impliedType: impliedType(l.conditions)
				}));
		}
	}

	// What a lane rule thinks, for the document in front of you only. Proposed
	// and never applied: a wrong guess looks exactly like a right one once it is
	// filed, so it stays a suggestion until somebody agrees with it.
	const proposals = current ? await loadProposals(handle, actor) : [];
	const match = proposals.find((p) => p.documentId === current) ?? null;
	const proposalShelf = match
		? filing.find((s) => (cards[s.key] ?? []).some((c) => c.id === match.organisationId))
		: null;

	return {
		waiting,
		current,
		index,
		shelves: queueShelves,
		cards,
		lanes,
		proposal:
			match && proposalShelf
				? {
						documentId: match.documentId,
						shelfKey: proposalShelf.key,
						cardId: match.organisationId,
						laneId: match.laneId,
						laneLabel: match.laneLabel,
						cardName: match.organisationName
					}
				: null
	};
}
