// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Open mode: sign-in without a credential, for the whole instance.
 *
 * Requested explicitly, and the consequence is recorded here rather than
 * mitigated. With it on, anyone who can reach the URL is any person on the
 * instance — including the administrator — and can read every statement,
 * salary figure, mortgage balance and tax statement, use the API and export
 * everything. On a plain-HTTP LAN address that is everyone on the network.
 *
 * Three rules give it the shape it has:
 *
 *   - Only an administrator may turn it on, and only by re-entering their own
 *     password. That is the last moment a password can prove intent, so it is
 *     where the proof is taken.
 *   - Turning it OFF needs nothing. Once the door is open anyone inside could
 *     close it anyway, and demanding a credential to close a door that is
 *     already open would only stop the honest.
 *   - Passwords are never deleted. Turning it off restores normal sign-in with
 *     every existing credential intact.
 *
 * It governs interactive sign-in only. The /api boundary, calendar feed tokens
 * and enrollment tokens keep their own checks and are not routed around.
 */

import { eq } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { person } from '$lib/server/db/schema';
import { verifyPassword } from '$lib/server/auth';
import { getSetting, setSetting } from '$lib/server/settings';

const KEY = 'openMode';

export type OpenModeResult = { ok: true } | { ok: false; status: 400 | 403; message: string };

/** Whether the instance currently signs people in without a credential. */
export async function isOpenMode(handle: Queryable = db): Promise<boolean> {
	return getSetting<boolean>(KEY, false, handle);
}

/**
 * Turn it on. Administrator only, and their password is required — not as a
 * second factor, but because it is the proof that the person asking for this
 * is the person who will live with it.
 */
export async function enableOpenMode(
	personId: string,
	password: string,
	handle: Queryable = db
): Promise<OpenModeResult> {
	const [actor] = await handle.select().from(person).where(eq(person.id, personId));
	if (!actor || actor.role !== 'admin') {
		return { ok: false, status: 403, message: 'Only an administrator can do that.' };
	}
	if (!actor.passwordHash) {
		// Nothing to prove intent with. Refusing is better than opening the
		// instance on the say-so of a session whose owner never set a password.
		return { ok: false, status: 400, message: 'Set a password before turning this on.' };
	}
	if (!(await verifyPassword(actor.passwordHash, password))) {
		return { ok: false, status: 403, message: 'That password is not right.' };
	}

	await setSetting(KEY, true, handle);
	return { ok: true };
}

/** Turn it off. Deliberately needs no credential — see the note above. */
export async function disableOpenMode(handle: Queryable = db): Promise<OpenModeResult> {
	await setSetting(KEY, false, handle);
	return { ok: true };
}
