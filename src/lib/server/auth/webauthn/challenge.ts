// WebAuthn challenges are per-browser and live for a moment, so they go in an
// httpOnly cookie rather than a table that would need a cleanup job. The
// cookie is read once and cleared, so a challenge cannot be replayed.

import { cookieSecure } from '$lib/server/auth/cookies';
import type { Cookies } from '@sveltejs/kit';

const CHALLENGE_COOKIE = 'continuum_webauthn_challenge';
const TTL_SECONDS = 5 * 60;

export function storeChallenge(cookies: Cookies, challenge: string): void {
	cookies.set(CHALLENGE_COOKIE, challenge, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: cookieSecure(),
		maxAge: TTL_SECONDS
	});
}

/** Reads and clears in one step — a challenge is good for exactly one attempt. */
export function takeChallenge(cookies: Cookies): string | null {
	const value = cookies.get(CHALLENGE_COOKIE) ?? null;
	cookies.delete(CHALLENGE_COOKIE, { path: '/' });
	return value;
}
