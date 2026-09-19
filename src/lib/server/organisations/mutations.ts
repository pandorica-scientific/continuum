// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Creating and editing organisations, and the role periods against them.
 *
 * An organisation is a thing paper is FILED AGAINST, like a subject — it lives
 * in the Documents rail (SHELVES/SUBJECTS/organisations), not Contacts. Mirrors
 * `documents/subjects.ts` deliberately: both are household-named records and
 * should behave the same regardless of which screen created them.
 */
import { asc, count, eq, sql } from 'drizzle-orm';
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
import type { EnumValue } from '$lib/enums';
import { foldCountry } from '$lib/countries';

export const ORGANISATION_NAME_TAKEN = 'An organisation with that name already exists.';
export const ORGANISATION_IN_USE =
	'That organisation still has paper filed against it, so it cannot be removed.';

const DEFAULT_ORGANISATION_EMOJI = '🏛️';

/** A name as the uniqueness index reads it: trimmed, inner whitespace collapsed. */
const normalise = (name: string): string => name.trim().replace(/\s+/g, ' ');

/**
 * The one collision a person can cause, as a sentence.
 *
 * Drizzle wraps the driver's `PostgresError` in `.cause` — the constraint name
 * is read from there, same as `subjects.ts`.
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
	/** Upper-case ISO 3166-1 alpha-2, or null where the household has not said. */
	country: string | null;
	documentCount: number;
	/** How many people have ever had a role period here. */
	peopleCount: number;
	/**
	 * Every role period, oldest first — not just the current one. A promotion is
	 * a second period; showing only the latest would erase when it happened.
	 */
	people: OrganisationPerson[];
}

/** Every organisation, with how much paper is filed against it. */
export async function listOrganisations(handle: Queryable = db): Promise<OrganisationRow[]> {
	const [rows, counted, people] = await Promise.all([
		handle
			.select({
				id: organisation.id,
				name: organisation.name,
				kind: organisation.kind,
				emoji: organisation.emoji,
				country: organisation.country
			})
			.from(organisation)
			.orderBy(organisation.name),
		// Grouped over every target, not narrowed to organisations: `document_link`
		// points at `entity`, and deciding which kinds exist isn't this module's job.
		handle
			.select({ targetId: documentLink.targetId, n: count() })
			.from(documentLink)
			.innerJoin(document, eq(document.id, documentLink.documentId))
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
 * Seeds, not rules — like `shelf_type`'s relationship to shelf seed rows.
 * Editing this list changes what the NEXT organisation starts with only.
 *
 * `other` seeds nothing: a kind with no rhythm would get wrong lanes, and a
 * wrong lane is noise while an empty one is a finding.
 */
export const LANE_PRESETS: Record<EnumValue<'organisation.kind'>, LanePreset[]> = {
	employer: [
		{
			label: 'Payslips',
			cadence: 'monthly',
			conditions: [{ field: 'type', op: 'is', value: 'payslip' }]
		},
		// Last and matching everything: lanes are tried in order, so this catches
		// whatever the others didn't claim — the contract itself, its
		// amendments, a raise or bonus letter, anything from HR.
		//
		// No yearly lane, deliberately. A declaration is one per person per year
		// and not one per employer: a year worked at two companies is filed once,
		// and two cards each drawing a missing 2025 were two alarms for one
		// obligation. It lives on the tax year card, which is keyed by the year
		// rather than by whoever happened to be paying. `authority` keeps its
		// yearly lane — a tax office really does expect one filing a year.
		{ label: 'Contract & HR', cadence: 'none', conditions: [] }
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
 * Trusted while corrected no more often than accepted, so a lane that keeps
 * being wrong falls silent without anybody having to turn it off. Pure, so
 * the rule can be tested without a database.
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
 * same call.
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

/**
 * The organisation with this name, minting one where the household has none.
 *
 * Idempotent, like `upsertSubjectByName`: two people adding "Tax office" on
 * two devices have agreed, not collided.
 */
export async function addOrganisation(
	input: {
		name: string;
		shelfId: string;
		kind?: EnumValue<'organisation.kind'>;
		emoji?: string;
		/** Folded here: a code, or nothing. */
		country?: string | null;
	},
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
			emoji: input.emoji?.trim() || DEFAULT_ORGANISATION_EMOJI,
			country: foldCountry(input.country)
		})
		.onConflictDoNothing()
		.returning({ id: organisation.id });

	// Lanes only for a row this call actually created — reusing an existing
	// name must not reseed over whatever the household has since changed.
	if (created.length > 0) {
		let sortOrder = 0;
		for (const preset of LANE_PRESETS[kind]) {
			await addLane({ entityId: created[0].id, ...preset, sortOrder }, handle);
			sortOrder += 10;
		}
	}

	// Read back rather than echoed from the input: on the reuse path the row's
	// country is whatever the household already set, not what this call said.
	const [row] = await handle
		.select({
			id: organisation.id,
			name: organisation.name,
			kind: organisation.kind,
			emoji: organisation.emoji,
			country: organisation.country
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

/**
 * Which country an organisation is in — what puts its role periods on a tax
 * year card. Clearing it is legal and means "not said", not "nowhere".
 */
export async function setOrganisationCountry(
	id: string,
	country: string | null,
	handle: Queryable = db
): Promise<void> {
	await handle
		.update(organisation)
		.set({ country: foldCountry(country) })
		.where(eq(organisation.id, id));
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
 * Same rule a shelf keeps: a document must always be somewhere. Role periods
 * cascade with it via the foreign key — a role has no meaning without the org.
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
 * Correct a role period entered without a start date, a title, or the wrong
 * one of either — the fields a person fills in once and, unlike `endsOn`,
 * might not have to hand at the moment they first record the period.
 */
export async function updateEngagement(
	id: string,
	input: { role?: string | null; startsOn?: string | null },
	handle: Queryable = db
): Promise<void> {
	const set: { role?: string | null; startsOn?: string | null } = {};
	if ('role' in input) set.role = input.role?.trim() || null;
	if ('startsOn' in input) set.startsOn = input.startsOn || null;
	if (Object.keys(set).length === 0) return;
	await handle.update(engagement).set(set).where(eq(engagement.id, id));
}

/**
 * Close a role period rather than deleting it.
 *
 * History is the point: a lane counts expected filings from the earliest start
 * across every period, so deleting one on promotion would shrink the count.
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
