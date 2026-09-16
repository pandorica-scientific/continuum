// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The household, the car, the dog — and the one action that demotes a whole
 * shelf's worth of paper without deleting any of it.
 *
 * This is the only writer of `archived_at`; a second place that set it would
 * be a second opinion about what closing a subject's period means.
 *
 * Subjects are NOT shelves and this module deliberately does not mirror
 * `shelves.ts` everywhere: no `key` (nothing refers to a subject by name), no
 * order (the rail sorts them), no delete (archiving is how history is put away).
 */
import { count, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { db, type Queryable } from '$lib/server/db';
import { document, documentLink, subject } from '$lib/server/db/schema';

/**
 * What a new subject gets when nobody picked an emoji.
 *
 * A folder rather than the house: 🏠 is the seeded household's, and a car
 * that looked the same would be indistinguishable at a glance.
 */
const DEFAULT_SUBJECT_EMOJI = '📁';

/** What a person is told when the name they typed is already taken. */
export const SUBJECT_NAME_TAKEN = 'A subject with that name already exists.';

export interface SubjectRow {
	id: string;
	name: string;
	emoji: string;
	archivedAt: Date | null;
	activeFrom: string | null;
	activeTo: string | null;
	/** How much paper is filed under it — behind the read rule, never around it. */
	documentCount: number;
	/** The seeded row. Renameable, but never archived. */
}

/**
 * True only for a unique violation on a subject's name.
 *
 * Two indexes can trip this — `subject_name_unique` and the case-insensitive
 * `subject_name_ci_idx` — matched by constraint name so an unrelated unique
 * violation is never reported as "that name is taken".
 *
 * Drizzle wraps the driver's `PostgresError` in a `DrizzleQueryError` with the
 * original as `.cause`, which is where the code and constraint are read from.
 */
function isNameTaken(error: unknown): boolean {
	const cause = error instanceof Error ? error.cause : undefined;
	return (
		cause instanceof postgres.PostgresError &&
		cause.code === '23505' &&
		(cause.constraint_name ?? '').includes('subject_name')
	);
}

/** Run a write, and turn the one collision a person can cause into a sentence. */
async function refusingDuplicates<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (isNameTaken(error)) throw new Error(SUBJECT_NAME_TAKEN, { cause: error });
		throw error;
	}
}

/**
 * Every subject, with how much paper is filed under it.
 *
 * The archive scope is deliberately NOT applied: an archived subject
 * reporting zero because its own archiving hid its own documents would be a
 * number that means nothing.
 */
export async function listSubjects(handle: Queryable = db): Promise<SubjectRow[]> {
	const [rows, counted] = await Promise.all([
		handle
			.select({
				id: subject.id,
				name: subject.name,
				emoji: subject.emoji,
				archivedAt: subject.archivedAt,
				activeFrom: subject.activeFrom,
				activeTo: subject.activeTo
			})
			.from(subject)
			.orderBy(subject.name),
		// Grouped over every target rather than narrowed to subjects: narrowing
		// would mean this module deciding which kinds exist, the registry's job.
		handle
			.select({ targetId: documentLink.targetId, n: count() })
			.from(documentLink)
			.innerJoin(document, eq(document.id, documentLink.documentId))
			.groupBy(documentLink.targetId)
	]);
	const countByTarget = new Map(counted.map((row) => [row.targetId, row.n]));
	return rows.map((row) => ({
		...row,
		// A subject nothing is filed under is a zero, not an absence.
		documentCount: countByTarget.get(row.id) ?? 0
	}));
}

/**
 * A new subject, refusing a name another subject already answers to.
 *
 * Takes the shelf it lives on: a car is on Vehicles and a boiler on Inventory,
 * and neither is offered when filing the other's paper.
 */
export async function addSubject(
	name: string,
	emoji: string,
	shelfId: string,
	handle: Queryable = db
): Promise<string> {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('A subject needs a name.');
	const id = uuidv7();
	await refusingDuplicates(() =>
		handle
			.insert(subject)
			.values({ id, name: trimmed, shelfId, emoji: emoji.trim() || DEFAULT_SUBJECT_EMOJI })
	);
	return id;
}

/**
 * The subject with this name, minting it if the household has not got one.
 *
 * Case-insensitive, matching the rail's stricter `addSubject`, so the two
 * read one uniqueness rule rather than two comparisons that happen to agree.
 */
export async function upsertSubjectByName(
	name: string,
	shelfId: string,
	handle: Queryable
): Promise<string> {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('A subject needs a name.');
	await handle
		.insert(subject)
		.values({ id: uuidv7(), name: trimmed, shelfId, emoji: DEFAULT_SUBJECT_EMOJI })
		.onConflictDoNothing();
	const [existing] = await handle
		.select({ id: subject.id })
		.from(subject)
		.where(sql`lower(${subject.name}) = ${trimmed.toLowerCase()}`);
	return existing.id;
}

/** Rename a subject. The household may be renamed like any other. */
export async function renameSubject(
	id: string,
	name: string,
	handle: Queryable = db
): Promise<void> {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('A subject needs a name.');
	await refusingDuplicates(() =>
		handle.update(subject).set({ name: trimmed }).where(eq(subject.id, id))
	);
}

/** Give a subject a different emoji. Empty means the default, never nothing. */
export async function setSubjectEmoji(
	id: string,
	emoji: string,
	handle: Queryable = db
): Promise<void> {
	await handle
		.update(subject)
		.set({ emoji: emoji.trim() || DEFAULT_SUBJECT_EMOJI })
		.where(eq(subject.id, id));
}

/** Today, as the date column spells it. */
const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Archive a subject: its paper leaves the default view, and nothing is deleted.
 *
 * Two columns, two jobs. `archived_at` is the switch every screen carrying
 * `archiveScopePredicate` reads. `active_to` is the day the subject stopped
 * being real, filled only if nobody already recorded one.
 *
 * `greatest` rather than the plain date keeps this from ever tripping
 * `subject_active_period_check` (a period that hasn't started yet would
 * otherwise end before it began); Postgres's `greatest` ignores NULLs.
 */
export async function archiveSubject(
	id: string,
	on: string = todayIso(),
	handle: Queryable = db
): Promise<void> {
	await handle
		.update(subject)
		.set({
			archivedAt: new Date(),
			activeTo: sql`coalesce(${subject.activeTo}, greatest(${subject.activeFrom}, ${on}::date))`
		})
		.where(eq(subject.id, id));
}

/**
 * Put a subject back: its paper returns to the default view.
 *
 * `active_to` is left exactly as it was: un-archiving says the paper is
 * current again, not that the period never ended.
 */
export async function unarchiveSubject(id: string, handle: Queryable = db): Promise<void> {
	await handle.update(subject).set({ archivedAt: null }).where(eq(subject.id, id));
}
