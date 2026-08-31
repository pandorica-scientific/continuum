// SPDX-License-Identifier: AGPL-3.0-or-later
// Household policy that another self-hoster may reasonably set differently, so
// both values are configurable — `PASSWORD_MIN_LENGTH` and
// `ENROLLMENT_LINK_DAYS` in the environment, read server-side by
// $lib/server/policy. The defaults live here because this module is the one
// both the server guards and the browser hints can import.
//
// The numbers reach the browser through page data rather than being imported
// there, so a placeholder can never advertise a minimum the server is not
// actually enforcing.

export const DEFAULT_PASSWORD_MIN_LENGTH = 8;
export const DEFAULT_ENROLLMENT_LINK_DAYS = 7;

/** "8+ characters", for a placeholder that cannot drift from the guard. */
export function passwordHint(minLength: number): string {
	return `${minLength}+ characters`;
}

/** One length rule and message shape for setup, enrollment and password changes. */
export function passwordLengthError(
	password: string,
	minLength: number,
	label = 'Password'
): string | null {
	return password.length < minLength ? `${label} needs at least ${minLength} characters.` : null;
}

/**
 * One mismatch rule and message shape for setup, enrollment and password
 * changes — the same reason the length rule above is shared.
 *
 * It had already drifted: enrollment said "The two passwords do not match."
 * and the settings screen said "The two new passwords do not match.", and
 * setup asked for the password only once, which is how a typo in the only
 * password on a fresh instance locked its owner out immediately.
 */
export function passwordsMatchError(
	password: string,
	confirmation: string,
	label = 'The two passwords'
): string | null {
	return password === confirmation ? null : `${label} do not match.`;
}

const WORDS = [
	'zero',
	'one',
	'two',
	'three',
	'four',
	'five',
	'six',
	'seven',
	'eight',
	'nine',
	'ten'
];

/** "seven days" / "14 days" — prose that survives the value being changed. */
export function daysPhrase(days: number): string {
	const count = WORDS[days] ?? String(days);
	return `${count} ${days === 1 ? 'day' : 'days'}`;
}
