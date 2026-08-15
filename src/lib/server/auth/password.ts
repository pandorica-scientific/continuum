// Changing your own password. Every other session is revoked on success —
// changing a password after a scare should actually eject the other device,
// which is the entire point of changing it.

import { and, eq, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { person, session } from '$lib/server/db/schema';
import { passwordMinLength } from '$lib/server/policy';
import { hashPassword, verifyPassword } from './index';

export async function revokeOtherSessions(personId: string, keepSessionId: string): Promise<void> {
	await db
		.delete(session)
		.where(and(eq(session.personId, personId), ne(session.id, keepSessionId)));
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
