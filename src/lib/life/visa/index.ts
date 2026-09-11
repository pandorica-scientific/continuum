// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Looking up a visa position, and saying how old the answer is.
 *
 * The only entry point to the table. Everything that shows a position goes
 * through here, so the "as of" date and the refusal-to-guess rule cannot be
 * skipped by a caller reading the table directly.
 */
import type { VisaPosition } from '$lib/life/readiness';
import { COVERED_PASSPORTS, VISA_AS_OF, VISA_TABLE } from './table';

export { VISA_AS_OF } from './table';

/**
 * What this passport needs for that destination.
 *
 * Returns `unknown` for a passport the table has never been checked for, and
 * for a destination it does not list. Never guesses, and in particular never
 * guesses visa-free: an unlisted pair is a gap in what the app knows, and
 * colouring a gap green is the one mistake here that costs somebody a holiday.
 *
 * A journey to the country the passport was issued by is visa-free without
 * needing a table entry, because a state cannot refuse its own citizens entry.
 */
export function visaPosition(passportCountry: string, destination: string): VisaPosition {
	const from = passportCountry.trim().toUpperCase();
	const to = destination.trim().toUpperCase();
	if (!/^[A-Z]{2}$/.test(from) || !/^[A-Z]{2}$/.test(to)) return 'unknown';
	if (from === to) return 'visa-free';
	return VISA_TABLE[from]?.[to] ?? 'unknown';
}

/** Whether this passport is one the table has been checked for at all. */
export const isCoveredPassport = (country: string): boolean =>
	(COVERED_PASSPORTS as readonly string[]).includes(country.trim().toUpperCase());

/**
 * The sentence printed under every readiness block.
 *
 * Built from the constant rather than written into a template, so the date on
 * screen cannot drift from the date the table was actually checked.
 */
export function visaCaption(): string {
	const day = new Date(`${VISA_AS_OF}T00:00:00Z`).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
	return `Visa data as of ${day} — check before you travel.`;
}
