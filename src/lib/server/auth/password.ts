// Changing your own password. Every other way in is revoked on success —
// changing a password after a scare should actually eject the other device,
// which is the entire point of changing it.

import { and, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { credential, person, session } from '$lib/server/db/schema';
import { passwordMinLength } from '$lib/server/policy';
import { hashPassword, verifyPassword } from './index';

/**
 * Revoke every way into this account except the session doing the revoking.
 *
 * Passkeys go too, and that is the point. Registering one needs only a live
 * session, so somebody holding a stolen cookie could enrol their own
 * authenticator and keep it — a credential is not tied to the password, and
 * passkey sign-in would go on minting fresh thirty-day sessions long after the
 * password had been changed. Deleting other sessions alone left the one door
 * the remedy was supposed to close standing open.
 *
 * The cost is that the account's own passkeys have to be enrolled again, which
 * is the correct trade when the reason for doing this is that someone else may
 * have had the account.
 */
export async function revokeOtherAccess(personId: string, keepSessionId: string): Promise<void> {
	await db.transaction(async (tx) => {
		await tx
			.delete(session)
			.where(and(eq(session.personId, personId), ne(session.id, keepSessionId)));
		await tx.delete(credential).where(eq(credential.personId, personId));
	});
}

export async function changeOwnPassword(
	personId: string,
	current: string,
	next: string
): Promise<{ ok: true } | { ok: false; message: string }> {
	const minLength = passwordMinLength();
	if (next.length < minLength) {
		return { ok: false, message: `New password needs at least ${minLength} characters.` };
	}
	const rows = await db
		.select({ passwordHash: person.passwordHash })
		.from(person)
		.where(eq(person.id, personId));
	const row = rows[0];
	if (!row || !(await verifyPassword(row.passwordHash, current))) {
		return { ok: false, message: 'Current password is wrong.' };
	}
	await db
		.update(person)
		.set({ passwordHash: await hashPassword(next) })
		.where(eq(person.id, personId));
	return { ok: true };
}
