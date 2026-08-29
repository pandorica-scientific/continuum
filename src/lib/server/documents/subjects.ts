// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The household, the car, the dog — and the one action that demotes a whole
 * shelf's worth of paper without deleting any of it.
 *
 * The READ half of archiving has existed since v0.7.0: `archiveScopePredicate`
 * is applied by the Documents load, `documentsAbout`, the briefing and the
 * calendar, and `tests/integration/archive-scope` holds its truth table. What
 * was missing was a writer — nothing in the application ever set `archived_at`,
 * so a subsystem with a test suite had no way to be switched on. This module is
 * that writer, and it is the only one: a second place that sets `archived_at`
 * would be a second opinion about what closing a subject's period means.
 *
 * Subjects are NOT shelves and this module deliberately does not mirror
 * `shelves.ts` everywhere. There is no `key`, because no code refers to a
 * subject by name; there is no order, because the rail sorts them; and there is
 * no delete, because a subject that once held paper is history and archiving is
 * how history is put away.
 */
import { asc, count, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { db, type Queryable } from '$lib/server/db';
import { document, documentLink, subject } from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from './visibility';

/**
 * What a new subject gets when nobody picked an emoji.
 *
 * A folder rather than the house: 🏠 is the seeded household's, and a car that
 * arrived looking like the household is a row nobody can tell apart at a
 * glance. Exported so the subject minted by typing a name into capture and the
 * subject added from the rail start out looking the same.
 */
export const DEFAULT_SUBJECT_EMOJI = '📁';

/** What a person is told when the name they typed is already taken. */
export const SUBJECT_NAME_TAKEN = 'A subject with that name already exists.';

/** What a person is told when they try to archive the household itself. */
export const HOUSEHOLD_NOT_ARCHIVABLE = 'The household is not something you archive.';

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
	household: boolean;
}

/**
 * True only for a unique violation on a subject's name.
 *
 * There are two indexes to trip — `subject_name_unique` on the name itself and
 * `subject_name_ci_idx` on `lower(name)` — and only the second is the one that
 * matters in practice, because "Car" and "car" are the same thing. Both are
 * matched by name rather than by error code alone, so an unrelated unique
 * violation is never reported to a person as "that name is taken".
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
 * The household's own subject — the row the baseline seeded, found by age.
 *
 * NOT by the word "Household": a Czech household may call it "Domácnost", the
 * ruling says it may be renamed, and a rule that reads the name would quietly
 * stop protecting it the moment somebody did. It is not by id either, because
 * the baseline seeds it with `gen_random_uuid()`. What is durably true is that
 * it existed before the database was handed over: every other subject is minted
 * by capture or by the rail, and therefore later.
 */
export async function householdSubjectId(handle: Queryable = db): Promise<string | null> {
	const [row] = await handle
		.select({ id: subject.id })
		.from(subject)
		.orderBy(asc(subject.createdAt), asc(subject.id))
		.limit(1);
	return row?.id ?? null;
}

/**
 * Every subject, with how much paper is filed under it.
 *
 * The count carries `visibleDocumentPredicate`, exactly as the shelf counts do:
 * a member seeing "3" beside a subject holding the two documents they can open
 * has been told a third exists, which is the one fact the read rule protects. A
 * null actor is a member, deliberately — the safe reading is the default.
 *
 * The ARCHIVE scope is deliberately NOT applied. This count is how much paper
 * the subject holds, and an archived subject reporting zero because its own
 * archiving hid its own documents would be a number that means nothing.
 */
export async function listSubjects(
	handle: Queryable = db,
	actor: Actor | null = null
): Promise<SubjectRow[]> {
	const [household, rows, counted] = await Promise.all([
		householdSubjectId(handle),
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
		// The read rule as a fragment inside the query, never a filter applied to
		// the rows afterwards. Grouped over every target rather than narrowed to
		// subjects: `document_link` points at `entity`, so a narrowing would mean
		// this module deciding which kinds exist, which is the registry's job.
		handle
			.select({ targetId: documentLink.targetId, n: count() })
			.from(documentLink)
			.innerJoin(document, eq(document.id, documentLink.documentId))
			.where(visibleDocumentPredicate(actor))
			.groupBy(documentLink.targetId)
	]);
	const countByTarget = new Map(counted.map((row) => [row.targetId, row.n]));
	return rows.map((row) => ({
		...row,
		// A subject nothing is filed under is a zero, not an absence.
		documentCount: countByTarget.get(row.id) ?? 0,
		household: row.id === household
	}));
}

/** A new subject, refusing a name another subject already answers to. */
export async function addSubject(
	name: string,
	emoji: string,
	handle: Queryable = db
): Promise<string> {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('A subject needs a name.');
	const id = uuidv7();
	await refusingDuplicates(() =>
		handle
			.insert(subject)
			.values({ id, name: trimmed, emoji: emoji.trim() || DEFAULT_SUBJECT_EMOJI })
	);
	return id;
}

/**
 * The subject with this name, minting it if the household has not got one.
 *
 * What capture's "or type a new one" field does, and what it has always done —
 * lifted here so the rail's stricter `addSubject` and capture's forgiving
 * upsert are two readings of ONE case-insensitive uniqueness rule rather than
 * two hand-written lowercase comparisons that agree today.
 */
export async function upsertSubjectByName(name: string, handle: Queryable): Promise<string> {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('A subject needs a name.');
	await handle
		.insert(subject)
		.values({ id: uuidv7(), name: trimmed, emoji: DEFAULT_SUBJECT_EMOJI })
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
 * Two columns, two different jobs. `archived_at` is the switch the read rule
 * reads — one timestamp, and every screen carrying `archiveScopePredicate`
 * demotes the paper at once. `active_to` is the day the subject stopped being
 * real, which is what lets an old document read as history rather than as an
 * expiry somebody forgot, and it is only filled if nobody had said when the
 * period ended; a household that recorded the sale date keeps it.
 *
 * The household cannot be archived. It is the one subject every document may
 * belong to, and archiving it would hide the household's own paper from the
 * household — refused here rather than hidden in the rail, so the refusal
 * holds for a second caller too.
 *
 * `greatest` rather than the plain date is what keeps this from ever being
 * refused by `subject_active_period_check`: a subject whose period has not
 * started yet would otherwise end before it began. Postgres's `greatest`
 * ignores NULLs, so an empty `active_from` leaves the day as it was given.
 */
export async function archiveSubject(
	id: string,
	on: string = todayIso(),
	handle: Queryable = db
): Promise<void> {
	if (id === (await householdSubjectId(handle))) throw new Error(HOUSEHOLD_NOT_ARCHIVABLE);
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
 * `active_to` is left exactly as it was, on purpose. Un-archiving says the
 * paper is current again; it does not say the period never ended, and rewriting
 * a recorded date as a side effect of an undo would destroy the one fact the
 * period columns exist to keep.
 */
export async function unarchiveSubject(id: string, handle: Queryable = db): Promise<void> {
	await handle.update(subject).set({ archivedAt: null }).where(eq(subject.id, id));
}
