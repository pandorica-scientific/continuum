import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { calendarConflict } from '$lib/server/db/schema';

// Recording a discarded edit, in one place.
//
// Both the sync engine and write-back write these rows, and both of them
// sometimes have nothing to record on one side: "edited here, deleted there" has
// no `theirs`, and a write-back on an event that has just appeared has no
// `ours`. That is an ordinary outcome, not a missing value.

/**
 * A side of a conflict, as jsonb.
 *
 * THE POINT OF THIS FUNCTION. `ours` and `theirs` are jsonb NOT NULL, so handing
 * drizzle a JavaScript null writes SQL NULL and the insert raises 23502 — inside
 * the engine's single commit transaction, which rolls the WHOLE pass back. The
 * cursor never advances, the links never get written, and every event is pushed
 * again on the next pass, which fails in exactly the same place. One event
 * edited here and deleted there was enough to wedge an account permanently.
 *
 * JSON null is a value, and it is the honest one: there is no series on that
 * side, and the row should say so rather than refuse to exist.
 */
function jsonbSide(value: unknown) {
	return sql`${JSON.stringify(value ?? null)}::jsonb`;
}

export interface ConflictRecord {
	localKey: string;
	accountId: string;
	ours: unknown;
	theirs: unknown;
	resolution: 'local-won' | 'remote-won' | 'wrote-back';
}

export async function recordConflict(handle: Queryable, record: ConflictRecord): Promise<void> {
	await handle.insert(calendarConflict).values({
		id: randomUUID(),
		localKey: record.localKey,
		accountId: record.accountId,
		ours: jsonbSide(record.ours) as never,
		theirs: jsonbSide(record.theirs) as never,
		resolution: record.resolution
	});
}

/**
 * Mark every outstanding conflict as seen.
 *
 * The briefing raises unacknowledged rows and nothing ever cleared them, so the
 * first write-back pinned a red card in a four-slot briefing with no way to
 * dismiss it — which, over a few weeks, is how a household learns to ignore the
 * briefing.
 *
 * Deliberately not automatic on viewing the calendar: these are edits that were
 * discarded and dates that changed in the ledger, so clearing them is an act,
 * not a side effect of navigation.
 */
export async function acknowledgeConflicts(handle: Queryable = db): Promise<number> {
	const cleared = await handle
		.update(calendarConflict)
		.set({ acknowledgedAt: new Date() })
		.where(isNull(calendarConflict.acknowledgedAt))
		.returning({ id: calendarConflict.id });
	return cleared.length;
}

/** Outstanding conflicts for one account, newest last. */
export async function listOpenConflicts(accountId: string, handle: Queryable = db) {
	return handle
		.select()
		.from(calendarConflict)
		.where(and(eq(calendarConflict.accountId, accountId), isNull(calendarConflict.acknowledgedAt)))
		.orderBy(calendarConflict.detectedAt);
}
