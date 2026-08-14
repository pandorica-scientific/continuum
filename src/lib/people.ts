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
