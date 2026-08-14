// One-time enrollment links. A person created by an administrator has no
// password until they open their link and choose one, so the administrator
// never knows it. Only the hash is stored — the raw token is shown once, the
// same handling sessions and API tokens already use.

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { enrollmentToken } from '$lib/server/db/schema';

const LIFETIME_DAYS = 7;

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
	const expiresAt = new Date(Date.now() + LIFETIME_DAYS * 24 * 60 * 60 * 1000);
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
 * The update is conditional on usedAt still being null, so two simultaneous
 * submissions cannot both succeed.
 */
export async function consumeEnrollmentToken(raw: string): Promise<{ personId: string } | null> {
	const id = hashToken(raw);
	const updated = await db
		.update(enrollmentToken)
		.set({ usedAt: new Date() })
		.where(and(eq(enrollmentToken.id, id), isNull(enrollmentToken.usedAt)))
		.returning({ personId: enrollmentToken.personId, expiresAt: enrollmentToken.expiresAt });
	const row = updated[0];
	if (!row) return null;
	if (row.expiresAt <= new Date()) return null;
	return { personId: row.personId };
}
