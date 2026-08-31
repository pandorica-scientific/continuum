// SPDX-License-Identifier: AGPL-3.0-or-later
// Household security policy, read from the environment so a self-hoster can
// disagree with our defaults without editing code. Both are deployment-wide
// rather than per-person, which is why they are environment variables and not
// rows in `setting` — there is no sensible per-household-member answer.
//
// Deliberately *not* here: the WebAuthn challenge TTL in webauthn/challenge.ts.
// That bounds a single in-flight ceremony — how long someone takes to touch a
// sensor — rather than expressing a policy anyone would hold an opinion about,
// and exposing it would only offer a way to weaken replay protection.

import { env } from '$env/dynamic/private';
import { DEFAULT_ENROLLMENT_LINK_DAYS, DEFAULT_PASSWORD_MIN_LENGTH } from '$lib/password-policy';

/** A positive whole number from the environment, or the default when it is not. */
function positiveInt(raw: string | undefined, fallback: number): number {
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function passwordMinLength(): number {
	return positiveInt(env.PASSWORD_MIN_LENGTH, DEFAULT_PASSWORD_MIN_LENGTH);
}

export function enrollmentLinkDays(): number {
	return positiveInt(env.ENROLLMENT_LINK_DAYS, DEFAULT_ENROLLMENT_LINK_DAYS);
}
