// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuidv7 } from 'uuidv7';
import { isNull, sql } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { calendarConflict } from '$lib/server/db/schema';

// The sync engine and write-back both write these rows; either side
// (`ours`/`theirs`) can legitimately be missing — not an error condition.

/**
 * A side of a conflict, as jsonb.
 *
 * `ours`/`theirs` are jsonb NOT NULL, so a plain JS `null` through drizzle
 * writes SQL NULL and fails the insert (23502), rolling back the whole sync
 * commit. JSON null is the correct encoding for "no side" and stays valid.
 */
function jsonbSide(value: unknown) {
	return sql`${JSON.stringify(value ?? null)}::jsonb`;
}

interface ConflictRecord {
	localKey: string;
	accountId: string;
	ours: unknown;
	theirs: unknown;
	resolution: 'local-won' | 'remote-won' | 'wrote-back';
}

export async function recordConflict(handle: Queryable, record: ConflictRecord): Promise<void> {
	await handle.insert(calendarConflict).values({
		id: uuidv7(),
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
 * Deliberately not automatic on viewing the calendar: acknowledging a
 * discarded edit is an act, not a side effect of navigation.
 */
export async function acknowledgeConflicts(handle: Queryable = db): Promise<number> {
	const cleared = await handle
		.update(calendarConflict)
		.set({ acknowledgedAt: new Date() })
		.where(isNull(calendarConflict.acknowledgedAt))
		.returning({ id: calendarConflict.id });
	return cleared.length;
}
