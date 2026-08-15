// WebAuthn challenges: issued here, spent exactly once here.
//
// The cookie carries the challenge back from the browser, but it is not the
// record of it. SvelteKit does not sign cookies, so a caller can put any value
// in that header — which meant `expectedChallenge` was whatever the request
// claimed, and a single captured assertion could be replayed into a fresh
// session indefinitely. The row in webauthn_challenge is the record: issuing
// writes one, verifying deletes it, and a verify that deletes nothing is a
// challenge this server either never issued or has already spent.

import { createHash } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { webauthnChallenge } from '$lib/server/db/schema';
import { cookieSecure } from '$lib/server/auth/cookies';
import type { Cookies } from '@sveltejs/kit';

const CHALLENGE_COOKIE = 'continuum_webauthn_challenge';
// Fixed on purpose, unlike the password and enrollment-link policy in
// $lib/server/policy. This bounds one in-flight ceremony — how long somebody
// takes to touch a sensor — rather than expressing a preference anyone holds,
// and the only thing a knob here would buy is a way to widen the replay window.
const TTL_SECONDS = 5 * 60;

/** Only the hash is stored, the way session and API tokens are handled. */
const idFor = (challenge: string) => createHash('sha256').update(challenge).digest('hex');

export async function storeChallenge(cookies: Cookies, challenge: string): Promise<void> {
	// Expired rows are cleared as we go, so this table needs no cleanup job.
	await db.delete(webauthnChallenge).where(lt(webauthnChallenge.expiresAt, new Date()));
	await db
		.insert(webauthnChallenge)
		.values({ id: idFor(challenge), expiresAt: new Date(Date.now() + TTL_SECONDS * 1000) })
		.onConflictDoNothing();
	cookies.set(CHALLENGE_COOKIE, challenge, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		maxAge: TTL_SECONDS
	});
}

/**
 * Read and spend the challenge, or null when there is nothing to spend.
 *
 * Null covers all of: no cookie, a cookie this server never issued, one already
 * used, and one past its five minutes. The caller cannot tell those apart, and
 * does not need to — every one of them means "do not verify against this".
 */
export async function takeChallenge(cookies: Cookies): Promise<string | null> {
	const value = cookies.get(CHALLENGE_COOKIE) ?? null;
	cookies.delete(CHALLENGE_COOKIE, { path: '/' });
	if (!value) return null;

	// Deleting and checking what came back is what makes this single-use: two
	// requests racing the same challenge, only one gets a row.
	const spent = await db
		.delete(webauthnChallenge)
		.where(eq(webauthnChallenge.id, idFor(value)))
		.returning({ expiresAt: webauthnChallenge.expiresAt });
	if (!spent[0] || spent[0].expiresAt.getTime() < Date.now()) return null;
	return value;
}
