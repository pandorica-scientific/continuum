// WebAuthn challenges are per-browser and live for a moment, so they go in an
// httpOnly cookie rather than a table that would need a cleanup job. The
// cookie is read once and cleared, so a challenge cannot be replayed.

import { cookieSecure } from '$lib/server/auth/cookies';
import type { Cookies } from '@sveltejs/kit';

const CHALLENGE_COOKIE = 'continuum_webauthn_challenge';
// Fixed on purpose, unlike the password and enrollment-link policy in
// $lib/server/policy. This bounds one in-flight ceremony — how long somebody
// takes to touch a sensor — rather than expressing a preference anyone holds,
// and the only thing a knob here would buy is a way to widen the replay window.
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
