// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Creating and editing organisations, and the role periods against them.
 *
 * The screen for this is a third section in the Documents rail, beside SHELVES
 * and SUBJECTS — not the Contacts area. An organisation earns its place here by
 * being a thing paper is FILED AGAINST, which is exactly what a subject is, so
 * it inherits the rail's vocabulary rather than growing a second one. A contact
 * is a person AT a company; putting an employer beside them would make "who do
 * I know" and "who pays me" the same list.
 *
 * Every refusal below is one a subject already makes, for the same reason. Where
 * this file and `documents/subjects.ts` look alike, that is the point: two
 * records a household creates by name should not behave differently depending
 * on which screen minted them.
 */
import { and, asc, count, eq, isNotNull, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { db, type Queryable } from '$lib/server/db';
import {
	document,
	documentLink,
	engagement,
	lane,
	organisation,
	person
} from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from '$lib/server/documents/visibility';
import type { EnumValue } from '$lib/enums';

export const ORGANISATION_NAME_TAKEN = 'An organisation with that name already exists.';
export const ORGANISATION_IN_USE =
	'That organisation still has paper filed against it, so it cannot be removed.';

const DEFAULT_ORGANISATION_EMOJI = '🏛️';

/** A name as the uniqueness index reads it: trimmed, inner whitespace collapsed. */
const normalise = (name: string): string => name.trim().replace(/\s+/g, ' ');

/**
 * The one collision a person can cause, as a sentence.
 *
 * Drizzle wraps the driver's `PostgresError` in a `DrizzleQueryError` with the
 * original as `.cause`, which is where the constraint name is read from — the
 * same unwrapping `subjects.ts` does, for the same driver.
 */
function isNameTaken(error: unknown): boolean {
	const cause = error instanceof Error ? error.cause : undefined;
	return (
		cause instanceof postgres.PostgresError &&
		cause.code === '23505' &&
		(cause.constraint_name ?? '').includes('organisation_name')
	);
}

async function refusingDuplicates<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (isNameTaken(error)) throw new Error(ORGANISATION_NAME_TAKEN, { cause: error });
		throw error;
	}
}

/** One role period, named the way the editor shows it. */
export interface OrganisationPerson {
	engagementId: string;
	personId: string;
	personName: string;
	role: string | null;
	startsOn: string | null;
	endsOn: string | null;
}

export interface OrganisationRow {
	id: string;
	name: string;
	kind: EnumValue<'organisation.kind'>;
	emoji: string;
	documentCount: number;
	/** How many people have ever had a role period here. */
	peopleCount: number;
	/**
	 * Every role period, oldest first — not just the current one.
	 *
	 * A promotion is a second period, so the editor has to show both or a person
	 * cannot tell the difference between "promoted in 2021" and "started in
	 * 2021", which is exactly the distinction the record exists to keep.
	 */
	people: OrganisationPerson[];
}

/** Every organisation, with how much paper the viewer may see filed against it. */
export async function listOrganisations(
	handle: Queryable = db,
	actor: Actor | null = null
): Promise<OrganisationRow[]> {
	const [rows, counted, people] = await Promise.all([
		handle
			.select({
				id: organisation.id,
				name: organisation.name,
				kind: organisation.kind,
				emoji: organisation.emoji
			})
			.from(organisation)
			.orderBy(organisation.name),
		// The read rule as a fragment inside the query, never a filter applied
		// afterwards — and grouped over every target rather than narrowed to
		// organisations, because `document_link` points at `entity` and deciding
		// which kinds exist is the registry's job, not this module's.
		handle
			.select({ targetId: documentLink.targetId, n: count() })
			.from(documentLink)
			.innerJoin(document, eq(document.id, documentLink.documentId))
			.where(visibleDocumentPredicate(actor))
			.groupBy(documentLink.targetId),
		handle
			.select({
				organisationId: engagement.organisationId,
				engagementId: engagement.id,
				personId: engagement.personId,
				personName: person.name,
				role: engagement.role,
				startsOn: engagement.startsOn,
				endsOn: engagement.endsOn
			})
			.from(engagement)
			.innerJoin(person, eq(person.id, engagement.personId))
			.orderBy(asc(engagement.startsOn), asc(engagement.id))
	]);

	const countByTarget = new Map(counted.map((row) => [row.targetId, row.n]));
	const periodsByOrg = new Map<string, OrganisationPerson[]>();
	for (const row of people) {
		const list = periodsByOrg.get(row.organisationId) ?? [];
		list.push(row);
		periodsByOrg.set(row.organisationId, list);
	}

	return rows.map((row) => {
		const periods = periodsByOrg.get(row.id) ?? [];
		return {
			...row,
			// An organisation nothing is filed against is a zero, not an absence.
			documentCount: countByTarget.get(row.id) ?? 0,
			// Distinct PEOPLE, not periods: a promotion is not a second colleague.
			peopleCount: new Set(periods.map((p) => p.personId)).size,
			people: periods
		};
	});
}

/** A lane as it ships, before the household has touched it. */
export interface LanePreset {
	label: string;
	cadence: EnumValue<'lane.cadence'>;
	/** For `yearly`: a cell every N years. Omitted means every year. */
	every?: number;
	conditions: { field: string; op: string; value: string }[];
}

/**
 * What each kind of organisation is expected to send, as a starting point.
 *
 * Seeds and not rules, the same relationship `shelf_type` has with the shelf
 * seed rows: this is what a fresh organisation begins with, and it
 * belongs to the household from the moment it exists. Editing this list changes
 * what the NEXT one starts with and touches nothing already created.
 *
 * `other` seeds nothing. A kind with no rhythm of its own would get lanes that
 * are wrong rather than lanes that are empty, and an empty lane is a finding
 * while a wrong one is noise.
 */
export const LANE_PRESETS: Record<EnumValue<'organisation.kind'>, LanePreset[]> = {
	employer: [
		{
			label: 'Payslips',
			cadence: 'monthly',
			conditions: [{ field: 'type', op: 'is', value: 'payslip' }]
		},
		{
			label: 'Once a year · declaration, annual settlement',
			cadence: 'yearly',
			conditions: [{ field: 'type', op: 'is', value: 'tax_document' }]
		},
		// Last, and matching everything: the lanes are tried in order, so a
		// no-cadence lane at the end is "whatever the others did not claim".
		{ label: 'Changes to pay', cadence: 'none', conditions: [] }
	],
	authority: [
		{
			label: 'Tax return',
			cadence: 'yearly',
			conditions: [{ field: 'type', op: 'is', value: 'tax_document' }]
		},
		{ label: 'Not tied to a year', cadence: 'none', conditions: [] }
	],
	insurer: [
		{
			label: 'Annual statement',
			cadence: 'yearly',
			conditions: [{ field: 'type', op: 'is', value: 'insurance_policy' }]
		},
		{ label: 'Correspondence', cadence: 'none', conditions: [] }
	],
	other: []
};

export interface LaneRow {
	id: string;
	/** The card this lane sits on, through the entity supertype. */
	entityId: string;
	personId: string | null;
	label: string;
	cadence: EnumValue<'lane.cadence'>;
	/** For `yearly`: a cell every N years. */
	every: number;
	conditions: unknown;
	acceptedCount: number;
	correctedCount: number;
	sortOrder: number;
}

/**
 * Whether this lane may still propose anything.
 *
 * Trusted while it has been corrected no more often than it has been accepted.
 * A lane that has never proposed starts trusted — it has done nothing wrong —
 * and one that keeps being wrong falls silent WITHOUT anybody having to notice
 * it and turn it off, which is the only way a rule nobody is watching stops
 * doing damage.
 *
 * Pure, so the rule can be read and tested without a database.
 */
export function laneTrusted(lane: { acceptedCount: number; correctedCount: number }): boolean {
	return lane.correctedCount <= lane.acceptedCount;
}

/** Record what happened to a proposal, in the same transaction as the link. */
export async function recordLaneOutcome(
	laneId: string,
	outcome: 'accepted' | 'corrected',
	handle: Queryable = db
): Promise<void> {
	const column = outcome === 'accepted' ? lane.acceptedCount : lane.correctedCount;
	await handle
		.update(lane)
		.set({ [outcome === 'accepted' ? 'acceptedCount' : 'correctedCount']: sql`${column} + 1` })
		.where(eq(lane.id, laneId));
}

/**
 * A card's lanes, in the order they are drawn and tried.
 *
 * Takes an ENTITY id, so a car's road tax and an employer's payslips are the
 * same call. It was `organisationId` while Income & Tax was the only shelf
 * drawing lanes.
 */
export async function lanesFor(entityId: string, handle: Queryable = db): Promise<LaneRow[]> {
	return handle
		.select({
			id: lane.id,
			entityId: lane.entityId,
			personId: lane.personId,
			label: lane.label,
			cadence: lane.cadence,
			every: lane.every,
			conditions: lane.conditions,
			acceptedCount: lane.acceptedCount,
			correctedCount: lane.correctedCount,
			sortOrder: lane.sortOrder
		})
		.from(lane)
		.where(eq(lane.entityId, entityId))
		.orderBy(asc(lane.sortOrder), asc(lane.id));
}

export async function addLane(
	input: {
		entityId: string;
		label: string;
		cadence: EnumValue<'lane.cadence'>;
		every?: number;
		personId?: string | null;
		conditions?: unknown;
		sortOrder?: number;
	},
	handle: Queryable = db
): Promise<{ id: string }> {
	const id = uuidv7();
	await handle.insert(lane).values({
		id,
		entityId: input.entityId,
		personId: input.personId ?? null,
		label: input.label.trim(),
		cadence: input.cadence,
		every: input.every ?? 1,
		conditions: input.conditions ?? [],
		sortOrder: input.sortOrder ?? 100
	});
	return { id };
}

export async function deleteLane(id: string, handle: Queryable = db): Promise<void> {
	await handle.delete(lane).where(eq(lane.id, id));
}

/**
 * The organisation with this name, minting one where the household has none.
 *
 * Idempotent rather than an error, exactly as `upsertSubjectByName` is: two
 * people adding "Tax office" on two devices have agreed, not collided.
 */
export async function addOrganisation(
	input: { name: string; shelfId: string; kind?: EnumValue<'organisation.kind'>; emoji?: string },
	handle: Queryable = db
): Promise<OrganisationRow> {
	const name = normalise(input.name);
	if (!name) throw new Error('An organisation needs a name.');

	const kind = input.kind ?? 'other';
	const created = await handle
		.insert(organisation)
		.values({
			id: uuidv7(),
			name,
			kind,
			shelfId: input.shelfId,
			emoji: input.emoji?.trim() || DEFAULT_ORGANISATION_EMOJI
		})
		.onConflictDoNothing()
		.returning({ id: organisation.id });

	// Lanes only for a row this call actually created. Adding by a name that
	// already exists returns the existing organisation, and seeding again would
	// put the app's guess back on top of whatever the household has since made
	// of it.
	if (created.length > 0) {
		let sortOrder = 0;
		for (const preset of LANE_PRESETS[kind]) {
			await addLane({ entityId: created[0].id, ...preset, sortOrder }, handle);
			sortOrder += 10;
		}
	}

	const [row] = await handle
		.select({
			id: organisation.id,
			name: organisation.name,
			kind: organisation.kind,
			emoji: organisation.emoji
		})
		.from(organisation)
		.where(sql`lower(${organisation.name}) = ${name.toLowerCase()}`);
	return { ...row, documentCount: 0, peopleCount: 0, people: [] };
}

export async function renameOrganisation(
	id: string,
	name: string,
	handle: Queryable = db
): Promise<void> {
	const trimmed = normalise(name);
	if (!trimmed) throw new Error('An organisation needs a name.');
	await refusingDuplicates(() =>
		handle.update(organisation).set({ name: trimmed }).where(eq(organisation.id, id))
	);
}

export async function setOrganisationKind(
	id: string,
	kind: EnumValue<'organisation.kind'>,
	handle: Queryable = db
): Promise<void> {
	await handle.update(organisation).set({ kind }).where(eq(organisation.id, id));
}

export async function setOrganisationEmoji(
	id: string,
	emoji: string,
	handle: Queryable = db
): Promise<void> {
	await handle
		.update(organisation)
		.set({ emoji: emoji.trim() || DEFAULT_ORGANISATION_EMOJI })
		.where(eq(organisation.id, id));
}

/**
 * Remove an organisation, refusing while anything is filed against it.
 *
 * The same rule a shelf keeps: a document must always be somewhere, and
 * deleting the employer out from under a payslip is not a delete anybody asked
 * for. Role periods go with it — a role has no meaning without the organisation
 * it was with — which the foreign key's CASCADE already does.
 */
export async function deleteOrganisation(id: string, handle: Queryable = db): Promise<void> {
	const [filed] = await handle
		.select({ n: count() })
		.from(documentLink)
		.where(eq(documentLink.targetId, id));
	if ((filed?.n ?? 0) > 0) throw new Error(ORGANISATION_IN_USE);
	await handle.delete(organisation).where(eq(organisation.id, id));
}

/** A role period. A promotion is a second call, never an edit to the first. */
export async function addEngagement(
	input: {
		organisationId: string;
		personId: string;
		role?: string | null;
		startsOn?: string | null;
		endsOn?: string | null;
		documentId?: string | null;
	},
	handle: Queryable = db
): Promise<{ id: string }> {
	const id = uuidv7();
	await handle.insert(engagement).values({
		id,
		organisationId: input.organisationId,
		personId: input.personId,
		role: input.role?.trim() || null,
		startsOn: input.startsOn || null,
		endsOn: input.endsOn || null,
		documentId: input.documentId || null
	});
	return { id };
}

/**
 * Close a role period rather than deleting it.
 *
 * History is the point: a lane counts the filings it expected from the earliest
 * start across every period, so a period removed on promotion takes its years
 * with it and the count silently shrinks.
 */
export async function endEngagement(
	id: string,
	endsOn: string,
	handle: Queryable = db
): Promise<void> {
	await handle.update(engagement).set({ endsOn }).where(eq(engagement.id, id));
}

/** Remove a role period entered by mistake. Ending one is `endEngagement`. */
export async function deleteEngagement(id: string, handle: Queryable = db): Promise<void> {
	await handle.delete(engagement).where(eq(engagement.id, id));
}

/** Role periods with a document behind them, for the card's pinned contract. */
export async function engagementsWithPaper(
	organisationId: string,
	handle: Queryable = db
): Promise<{ id: string; documentId: string }[]> {
	return handle
		.select({ id: engagement.id, documentId: sql<string>`${engagement.documentId}` })
		.from(engagement)
		.where(and(eq(engagement.organisationId, organisationId), isNotNull(engagement.documentId)));
}
