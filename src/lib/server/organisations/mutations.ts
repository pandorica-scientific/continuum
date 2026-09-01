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
import { document, documentLink, engagement, organisation, person } from '$lib/server/db/schema';
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

/**
 * The organisation with this name, minting one where the household has none.
 *
 * Idempotent rather than an error, exactly as `upsertSubjectByName` is: two
 * people adding "Tax office" on two devices have agreed, not collided.
 */
export async function addOrganisation(
	input: { name: string; kind?: EnumValue<'organisation.kind'>; emoji?: string },
	handle: Queryable = db
): Promise<OrganisationRow> {
	const name = normalise(input.name);
	if (!name) throw new Error('An organisation needs a name.');

	await handle
		.insert(organisation)
		.values({
			id: uuidv7(),
			name,
			kind: input.kind ?? 'other',
			emoji: input.emoji?.trim() || DEFAULT_ORGANISATION_EMOJI
		})
		.onConflictDoNothing();

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
