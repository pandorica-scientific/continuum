// SPDX-License-Identifier: AGPL-3.0-or-later
// Configurable via `PASSWORD_MIN_LENGTH` / `ENROLLMENT_LINK_DAYS` env vars, read
// server-side by $lib/server/policy. Defaults live here since both server
// guards and browser hints import this module; the browser gets the actual
// values via page data, never by importing the env, so a hint can't drift
// from what the server enforces.

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

/** One mismatch rule and message shape for setup, enrollment and password changes. */
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
