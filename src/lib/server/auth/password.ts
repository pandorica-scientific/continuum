// SPDX-License-Identifier: AGPL-3.0-or-later
// Changing your own password. Every other way in is revoked on success —
// changing a password after a scare should actually eject the other device,
// which is the entire point of changing it.

import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { passwordMinLength } from '$lib/server/system/policy';
import { passwordLengthError } from '$lib/password-policy';
import { hashPassword, verifyPassword } from './index';
import { revokeAuthenticationGeneration } from './generation';

/**
 * Revoke every way into this account except the session doing the revoking:
 * every other session is ended, because a password somebody else may have
 * learned is a password that may have minted sessions they still hold.
 */
export async function changeOwnPassword(
	personId: string,
	current: string,
	next: string,
	keepSessionId: string | null
): Promise<{ ok: true } | { ok: false; message: string }> {
	const passwordError = passwordLengthError(next, passwordMinLength(), 'New password');
	if (passwordError) return { ok: false, message: passwordError };
	const rows = await db
		.select({ passwordHash: person.passwordHash })
		.from(person)
		.where(eq(person.id, personId));
	const row = rows[0];
	const correct = await verifyPassword(row?.passwordHash ?? null, current);
	if (!row || row.passwordHash === null || !correct) {
		return { ok: false, message: 'Current password is wrong.' };
	}
	const previousHash = row.passwordHash;
	const nextHash = await hashPassword(next);
	const changed = await db.transaction(async (tx) => {
		const updated = await tx
			.update(person)
			.set({ passwordHash: nextHash })
			.where(and(eq(person.id, personId), eq(person.passwordHash, previousHash)))
			.returning({ id: person.id });
		if (!updated[0]) return false;
		await revokeAuthenticationGeneration(tx, personId, keepSessionId);
		return true;
	});
	if (!changed) {
		return {
			ok: false,
			message: 'Authentication changed while updating the password — try again.'
		};
	}
	return { ok: true };
}
