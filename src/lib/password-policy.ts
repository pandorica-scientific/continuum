// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
