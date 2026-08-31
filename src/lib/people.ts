// SPDX-License-Identifier: AGPL-3.0-or-later
// Derivations shared by every path that creates a person — the setup wizard,
// an administrator adding someone, and the demo seeder. Keeping them here is
// what stops the same person getting different initials depending on which
// door they came through.

export const EARLIEST_BIRTH_YEAR = 1900;

/** The two-letter monogram shown in the avatar chip. */
export function initialsFor(name: string): string {
	return name
		.split(/\s+/)
		.map((w) => w[0] ?? '')
		.join('')
		.slice(0, 2)
		.toUpperCase();
}

/**
 * `null` when the field was left blank, `'invalid'` for anything that is not a
 * plausible year. The form field is `inputmode="numeric"`, which is a keyboard
 * hint and not a constraint, so "19 88" reaches the server and `Number()` turns
 * it into NaN — which Postgres rejects for an integer column with a 500.
 */
export function parseBirthYear(raw: string, now: Date): number | null | 'invalid' {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const year = Number(trimmed);
	if (!Number.isInteger(year)) return 'invalid';
	if (year < EARLIEST_BIRTH_YEAR || year > now.getFullYear()) return 'invalid';
	return year;
}

export const BIRTH_YEAR_ERROR = `Birth year must be a whole year between ${EARLIEST_BIRTH_YEAR} and now.`;

/**
 * The colours a person is drawn in, wherever the app names one.
 *
 * The tail of the ranked reserve rather than its head: `hueTokens` in
 * $lib/tax-hues hands out the four soft steps and then r1 upward for
 * jurisdictions, and a person tag sitting beside a country pill in the same
 * colour would say the two were related. Eight jurisdictions would have to be
 * filed before the two sets meet at all.
 */
const PERSON_HUES = [
	'--series-r10',
	'--series-r9',
	'--series-r8',
	'--series-r7',
	'--series-r6',
	'--series-r5'
] as const;

/**
 * Which colour each person is, for the whole app.
 *
 * Assigned over the WHOLE household in a stable order, not over whoever happens
 * to appear on the screen being drawn — a person who is teal on Salary and
 * purple on Tax is not a tag, it is decoration. The ids are uuidv7, so sorting
 * them is oldest-first: the person who was added first keeps their colour when
 * a second is added later.
 */
export function personHues(ids: readonly string[]): Map<string, string> {
	const sorted = [...new Set(ids)].sort();
	return new Map(sorted.map((id, i) => [id, PERSON_HUES[i % PERSON_HUES.length]]));
}
