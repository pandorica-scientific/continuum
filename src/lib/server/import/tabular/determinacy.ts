/**
 * What the data itself settles, and what it leaves open.
 *
 * The auto-import policy rests on a distinction this module makes concrete: a
 * reading is either UNIQUELY DETERMINED by the file, or it is not, and the
 * second case is a question for the user rather than a guess for us. Nothing
 * here scores plausibility — every answer is accompanied by the evidence that
 * forced it, or by an honest admission that nothing did.
 */

export type Determinacy<T> =
	| { kind: 'determined'; value: T; evidence: string }
	| { kind: 'ambiguous'; candidates: T[]; reason: string }
	| { kind: 'unavailable'; reason: string };

export type DateOrder = 'year-first' | 'day-first' | 'month-first';
export type DecimalMark = ',' | '.';

/**
 * A numeric date. The year is OPTIONAL because US statements print entry
 * dates and daily balances as bare MM/DD, and a column of those still tells
 * us whether the order is day-first.
 */
const NUMERIC_DATE =
	/^\s*(\d{1,4})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?\.?\s*(?:[T\s]+\d{1,2}:\d{2}(?::\d{2})?)?\s*$/;

/**
 * The shape is not enough — the COMPONENTS have to be a possible date.
 *
 * Anchoring the pattern was assumed to be sufficient, and it is not: on any
 * dot-decimal statement `88.40`, `377.93` and `1234.56` all match it, so an
 * entire money column reads as a column of dates and the amount column then
 * cannot be found at all. The comment here used to claim `1.234` was the case
 * this guarded against; that one is excluded by the two-digit group, and every
 * ordinary two-decimal amount sailed through.
 *
 * A component above its range settles it. `12.05` stays a date because it
 * genuinely is ambiguous — December 5th and twelve euros five look identical,
 * and inventing a rule to separate them would be a guess.
 */
function matchNumericDate(value: string): RegExpExecArray | null {
	const m = NUMERIC_DATE.exec(value);
	if (!m) return null;
	const first = Number(m[1]);
	const second = Number(m[2]);

	// Year-first: a four-digit lead, then month then day.
	if (m[1].length === 4) return second >= 1 && second <= 12 ? m : null;

	// Otherwise the pair is day/month in one order or the other. Zero is not a
	// day or a month in either.
	if (first < 1 || second < 1) return null;
	const dayFirst = first <= 31 && second <= 12;
	const monthFirst = first <= 12 && second <= 31;
	return dayFirst || monthFirst ? m : null;
}

/** Is this cell a date at all? The one definition every module shares. */
export const isDateLike = (value: string): boolean => matchNumericDate(value) !== null;

/**
 * Day-first or month-first?
 *
 * The only reliable evidence inside the dates is a component above twelve.
 * When a whole column stays at or below twelve — which a fabricated US
 * statement can do deliberately and a real short period can do by accident —
 * the file cannot settle it, and the statement's own printed period can.
 *
 * Monotonicity is deliberately NOT used as evidence. Banks post in operational
 * order, so a sequence that runs backwards is normal and proves nothing.
 */
export function resolveDateOrder(
	values: string[],
	period?: { start?: string; end?: string }
): Determinacy<DateOrder> {
	let parsed = 0;
	let firstOverTwelve = false;
	let secondOverTwelve = false;
	let isoLike = 0;

	for (const value of values) {
		const m = matchNumericDate(value);
		if (!m) continue;
		parsed++;
		if (m[1].length === 4) {
			isoLike++;
			continue;
		}
		if (Number(m[1]) > 12) firstOverTwelve = true;
		if (Number(m[2]) > 12) secondOverTwelve = true;
	}

	if (parsed === 0) return { kind: 'unavailable', reason: 'no dates could be read' };
	if (isoLike === parsed) {
		return {
			kind: 'determined',
			value: 'year-first',
			evidence: 'every date leads with a 4-digit year'
		};
	}
	if (firstOverTwelve && secondOverTwelve) {
		return {
			kind: 'ambiguous',
			candidates: [],
			reason: 'some dates need day-first and others month-first, so the column is not one format'
		};
	}
	if (firstOverTwelve) {
		return { kind: 'determined', value: 'day-first', evidence: 'a day above 12 appears first' };
	}
	if (secondOverTwelve) {
		return { kind: 'determined', value: 'month-first', evidence: 'a day above 12 appears second' };
	}

	// Nothing inside the dates decides it. The printed period can: only one
	// reading puts every date inside the period the statement claims to cover.
	if (period?.start && period?.end) {
		const periodYear = Number(period.start.slice(0, 4));
		const fits = (order: DateOrder) =>
			values.every((value) => {
				const iso = applyDateOrder(value, order, periodYear);
				return !iso || (iso >= period.start! && iso <= period.end!);
			});
		const dayFirst = fits('day-first');
		const monthFirst = fits('month-first');
		if (dayFirst !== monthFirst) {
			return {
				kind: 'determined',
				value: dayFirst ? 'day-first' : 'month-first',
				evidence: `only this reading places every date inside ${period.start} to ${period.end}`
			};
		}
	}

	return {
		kind: 'ambiguous',
		candidates: ['day-first', 'month-first'],
		reason: `every day and month is 12 or lower across ${parsed} dates, and nothing else in the file settles the order`
	};
}

/**
 * Apply a resolved order to one value, yielding an ISO date.
 *
 * `fallbackYear` supplies the year for the bare MM/DD dates US statements
 * print; without one such a value has no ISO form and returns undefined rather
 * than inventing a year.
 */
export function applyDateOrder(
	value: string,
	order: DateOrder,
	fallbackYear?: number
): string | undefined {
	const m = matchNumericDate(value);
	if (!m) return undefined;
	let year: string;
	let month: string;
	let day: string;

	if (m[1].length === 4) {
		[year, month, day] = [m[1], m[2], m[3] ?? ''];
	} else if (order === 'month-first') {
		[month, day] = [m[1], m[2]];
		year = m[3] ?? '';
	} else {
		[day, month] = [m[1], m[2]];
		year = m[3] ?? '';
	}

	if (!year) {
		if (fallbackYear === undefined) return undefined;
		year = String(fallbackYear);
	}
	if (year.length === 2) {
		const yy = Number(year);
		year = String(yy >= 70 ? 1900 + yy : 2000 + yy);
	}
	const monthNumber = Number(month);
	const dayNumber = Number(day);
	if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return undefined;
	return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

const NUMBER_SHAPE = /^-?\(?\s*[\d.,\s'\u00A0\u202F]+\s*\)?-?$/;

/**
 * Comma or dot for the decimal?
 *
 * Decided over the WHOLE column, never one value. `1.234` alone is genuinely
 * ambiguous — a thousand and change, or one point two three four — and a
 * parser that picks per value will read a column two different ways.
 */
export function resolveDecimalMark(values: string[]): Determinacy<DecimalMark> {
	let both = 0;
	let commaDecimal = 0;
	let dotDecimal = 0;
	let commaGroup = 0;
	let dotGroup = 0;
	let seen = 0;
	let lastBoth: DecimalMark | undefined;

	for (const raw of values) {
		if (!raw || !NUMBER_SHAPE.test(raw)) continue;
		const value = raw.replace(/[\s'\u00A0\u202F()-]/g, '');
		if (!/\d/.test(value)) continue;
		seen++;
		const comma = value.lastIndexOf(',');
		const dot = value.lastIndexOf('.');

		if (comma !== -1 && dot !== -1) {
			// Whichever comes last is the decimal; the other groups thousands.
			both++;
			lastBoth = comma > dot ? ',' : '.';
			continue;
		}
		// Exactly three trailing digits reads equally as a thousands group; one or
		// two can only be a fraction.
		if (comma !== -1) {
			if (value.length - comma - 1 === 3) commaGroup++;
			else commaDecimal++;
		}
		if (dot !== -1) {
			if (value.length - dot - 1 === 3) dotGroup++;
			else dotDecimal++;
		}
	}

	if (seen === 0) return { kind: 'unavailable', reason: 'no numbers to inspect' };
	if (both > 0 && lastBoth) {
		return {
			kind: 'determined',
			value: lastBoth,
			evidence: `a value uses both separators, and "${lastBoth}" comes last`
		};
	}
	if (commaDecimal > 0 && dotDecimal === 0) {
		return { kind: 'determined', value: ',', evidence: 'commas are followed by one or two digits' };
	}
	if (dotDecimal > 0 && commaDecimal === 0) {
		return { kind: 'determined', value: '.', evidence: 'dots are followed by one or two digits' };
	}
	if (commaDecimal > 0 && dotDecimal > 0) {
		return {
			kind: 'ambiguous',
			candidates: [',', '.'],
			reason: 'both separators appear with fractional digits, so the column mixes conventions'
		};
	}
	if (commaGroup > 0 && dotGroup === 0) {
		return {
			kind: 'ambiguous',
			candidates: [',', '.'],
			reason:
				'every comma is followed by exactly three digits, which is equally a thousands separator'
		};
	}
	if (dotGroup > 0 && commaGroup === 0) {
		return {
			kind: 'ambiguous',
			candidates: ['.', ','],
			reason:
				'every dot is followed by exactly three digits, which is equally a thousands separator'
		};
	}
	return {
		kind: 'unavailable',
		reason: 'the numbers carry no separator, so both readings agree'
	};
}

/**
 * Parse one displayed amount into minor units under a resolved convention.
 *
 * Handles the sign forms statements actually use: a leading minus, a trailing
 * minus (German exports), and parentheses (US accounting). Returns null rather
 * than guessing when the text is not a number.
 */
export function parseAmount(raw: string, decimal: DecimalMark, minorDigits = 2): bigint | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!NUMBER_SHAPE.test(trimmed)) return null;

	const negative =
		trimmed.startsWith('-') ||
		trimmed.endsWith('-') ||
		(trimmed.startsWith('(') && trimmed.endsWith(')'));

	// Strip everything that is not a digit or the decimal mark.
	const group = decimal === ',' ? '.' : ',';
	const cleaned = trimmed
		.replace(/[()\s'\u00A0\u202F-]/g, '')
		.split(group)
		.join('')
		.replace(decimal, '.');
	if (!/^\d*\.?\d*$/.test(cleaned) || !/\d/.test(cleaned)) return null;

	const [whole, fraction = ''] = cleaned.split('.');
	const padded = (fraction + '0'.repeat(minorDigits + 1)).slice(0, minorDigits + 1);
	let minor =
		BigInt(whole || '0') * 10n ** BigInt(minorDigits) + BigInt(padded.slice(0, minorDigits) || '0');
	if (Number(padded[minorDigits]) >= 5) minor += 1n;
	return negative ? -minor : minor;
}
