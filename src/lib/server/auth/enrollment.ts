// One-time enrollment links. A person created by an administrator has no
// password until they open their link and choose one, so the administrator
// never knows it. Only the hash is stored — the raw token is shown once, the
// same handling sessions and API tokens already use.

import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { enrollmentToken } from '$lib/server/db/schema';
import { hashToken } from '$lib/server/auth/token-hash';
import { enrollmentLinkDays } from '$lib/server/policy';

export type EnrollmentStatus = 'valid' | 'expired' | 'used' | 'unknown';

export interface EnrollmentRow {
	expiresAt: Date;
	usedAt: Date | null;
}

/**
 * Pure lifecycle decision, split out so it is testable without a database.
 * "used" outranks "expired": a consumed token is spent regardless of its
 * window. Callers must render every non-valid status identically — the
 * distinction is for logs, never for the visitor.
 */
export function enrollmentStatus(row: EnrollmentRow | undefined, now: Date): EnrollmentStatus {
	if (!row) return 'unknown';
	if (row.usedAt) return 'used';
	if (row.expiresAt <= now) return 'expired';
	return 'valid';
}

export async function createEnrollmentToken(personId: string): Promise<{ raw: string }> {
	const raw = randomBytes(32).toString('base64url');
	const id = hashToken(raw);
	const expiresAt = new Date(Date.now() + enrollmentLinkDays() * 24 * 60 * 60 * 1000);
	// One live link per person: reissuing invalidates the previous one.
	//
	// A DELETE followed by an INSERT only looked like it enforced that. Nothing
	// in the table stopped two rows for one person, so two administrators — or
	// one double-clicked "New link" — both deleted, then both inserted, and two
	// independent links were spendable at once. The older URL, quite possibly the
	// one that went to the wrong address, kept working. This is a single
	// statement against a unique person_id: the second writer overwrites the
	// first, and the invariant is the database's to keep rather than a comment's.
	await db
		.insert(enrollmentToken)
		.values({ id, personId, expiresAt })
		.onConflictDoUpdate({
			target: enrollmentToken.personId,
			// usedAt too: this is a fresh link, whatever became of the last one.
			set: { id, expiresAt, usedAt: null }
		});
	return { raw };
}

/** Reads without consuming, for rendering the enrollment page. */
export async function lookupEnrollmentToken(
	raw: string
): Promise<{ personId: string; status: EnrollmentStatus }> {
	const rows = await db
		.select()
		.from(enrollmentToken)
		.where(eq(enrollmentToken.id, hashToken(raw)));
	const row = rows[0];
	return {
		personId: row?.personId ?? '',
		status: enrollmentStatus(row, new Date())
	};
}

/**
 * Marks the token used and returns its person, or null when it was not valid.
 *
 * Every condition lives in the UPDATE's own predicate. Two simultaneous
 * submissions therefore cannot both succeed, and — the reason expiry is checked
 * here rather than on the returned row — submitting an expired link no longer
 * stamps `usedAt` on it on the way to being rejected. That would have flipped
 * its status from `expired` to `used`, the one distinction enrollmentStatus
 * draws, on a route any unauthenticated visitor can reach.
 */
export async function consumeEnrollmentToken(raw: string): Promise<{ personId: string } | null> {
	const now = new Date();
	const updated = await db
		.update(enrollmentToken)
		.set({ usedAt: now })
		.where(
			and(
				eq(enrollmentToken.id, hashToken(raw)),
				isNull(enrollmentToken.usedAt),
				gt(enrollmentToken.expiresAt, now)
			)
		)
		.returning({ personId: enrollmentToken.personId });
	const row = updated[0];
	return row ? { personId: row.personId } : null;
}

/**
 * Voids any outstanding link for a person. Deactivation calls this: the account
 * is closed, so a link minted before it must not still be spendable.
 */
export async function revokeEnrollmentTokens(personId: string, on: Queryable = db): Promise<void> {
	await on.delete(enrollmentToken).where(eq(enrollmentToken.personId, personId));
}
