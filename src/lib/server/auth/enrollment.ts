// One-time enrollment links. A person created by an administrator has no
// password until they open their link and choose one, so the administrator
// never knows it. Only the hash is stored — the raw token is shown once, the
// same handling sessions and API tokens already use.

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { enrollmentToken } from '$lib/server/db/schema';
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

function hashToken(raw: string): string {
	return createHash('sha256').update(raw).digest('hex');
}

export async function createEnrollmentToken(personId: string): Promise<{ raw: string }> {
	const raw = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + enrollmentLinkDays() * 24 * 60 * 60 * 1000);
	// One live link per person: reissuing invalidates the previous one.
	await db.delete(enrollmentToken).where(eq(enrollmentToken.personId, personId));
	await db.insert(enrollmentToken).values({ id: hashToken(raw), personId, expiresAt });
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
