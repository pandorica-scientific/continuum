// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Pure arithmetic for the tax-statements screen. Nothing here computes what is
// owed — no brackets, no allowances, no residency. The only calculation is a
// ratio of two figures the user recorded, and grouping them into chart series.

import { toMajor } from '$lib/money';

interface StatementLike {
	personId: string;
	personName: string;
	year: number;
	country: string;
	currency: string;
	grossIncomeMinor: bigint;
	taxPaidMinor: bigint;
}

/**
 * A posted view preference, made safe.
 *
 * The column is jsonb and stores whatever it is handed, so nothing arriving
 * over the wire is trusted: an unknown mode, a currency nothing can convert, or
 * a person id belonging to nobody all fall back rather than being stored. The
 * same reasoning as the Overview board's layout normaliser.
 */
export function normaliseTaxView(
	body: unknown,
	personIds: string[],
	currencies: string[],
	baseCurrency: string
): TaxViewPrefs {
	// The household's own currency, explicitly — never `currencies[0]`. That
	// list is alphabetical, so falling back to its head silently displayed a
	// EUR household's whole record in Australian dollars.
	const fallback: TaxViewPrefs = {
		mode: 'stack',
		currency: baseCurrency,
		person: 'both'
	};
	if (typeof body !== 'object' || body === null) return fallback;
	const raw = body as Record<string, unknown>;
	return {
		mode: raw.mode === 'rate' ? 'rate' : 'stack',
		currency:
			typeof raw.currency === 'string' &&
			(raw.currency === baseCurrency || currencies.includes(raw.currency))
				? raw.currency
				: fallback.currency,
		person:
			typeof raw.person === 'string' && (raw.person === 'both' || personIds.includes(raw.person))
				? raw.person
				: 'both'
	};
}

/**
 * What a file attached to a statement actually is.
 *
 * Not a stored column. The kind picks the document's name and the tag applied
 * to it — both things the document aggregate already takes — so a household can
 * filter every broker report across every year without a schema change, and a
 * shelf full of `scan_0043.pdf` never happens.
 */
export const ATTACHMENT_KINDS = [
	{ key: 'statement', label: 'Statement', noun: 'tax statement', tag: 'tax statement' },
	{
		key: 'employer',
		label: 'Employer earnings report',
		noun: 'employer earnings report',
		tag: 'employer report'
	},
	{
		key: 'broker',
		label: 'Broker earnings report',
		noun: 'broker earnings report',
		tag: 'broker report'
	},
	{ key: 'other', label: 'Other', noun: 'tax document', tag: 'tax' }
] as const;

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]['key'];

/** A key off a form is whatever the browser sent; an unknown one files as other. */
export function attachmentKind(key: string): (typeof ATTACHMENT_KINDS)[number] {
	return ATTACHMENT_KINDS.find((kind) => kind.key === key) ?? ATTACHMENT_KINDS[3];
}

/**
 * What a filed document is called on the Finance shelf.
 *
 * Derived from the statement and the kind, not typed again: the name a document
 * is found by should say the same thing the statement says, and a second
 * free-text field would be free to disagree with it.
 *
 * `filename` is appended only when the caller already knows the derived name
 * collides with one linked to the same statement. Two broker reports in one
 * year are two files, and a name identifying neither identifies nothing.
 */
export function statementDocumentName(
	year: number,
	country: string,
	kind: AttachmentKind = 'statement',
	filename?: string
): string {
	const base = `${year} ${country.trim().toUpperCase()} ${attachmentKind(kind).noun}`;
	const suffix = filename?.trim();
	return suffix ? `${base} · ${suffix}` : base;
}

/**
 * How a person last left the Tax screen.
 *
 * Preferences, not transient UI: a chart mode and a display currency chosen
 * once should still be chosen tomorrow. Stored on the person the same way the
 * Overview board's layout is, for the same reason.
 */
export interface TaxViewPrefs {
	mode: 'stack' | 'rate';
	currency: string;
	/** A person id, or 'both' for the whole household. */
	person: string;
}

export interface SeriesPoint {
	year: number;
	grossMinor: bigint;
	taxMinor: bigint;
	grossMajor: number;
	taxMajor: number;
	ratePct: number | null;
}

export interface Series {
	/** `${personId}|${country}|${currency}` */
	key: string;
	/** "Jana · CZ" */
	label: string;
	currency: string;
	points: SeriesPoint[];
}

/**
 * Effective rate to two decimal places, or null when gross is zero. The ratio
 * is taken in bigint before converting, so it never passes through a float.
 */
export function effectiveRatePct(grossMinor: bigint, taxMinor: bigint): number | null {
	if (grossMinor === 0n) return null;
	return Number((taxMinor * 10000n) / grossMinor) / 100;
}

/** One month's gross, as `salary_entry` records it. */
export interface SalaryGrossMonth {
	personId: string;
	periodMonth: string;
	grossMinor: bigint | null;
	currency: string;
}

/**
 * What a person's salary record says they earned GROSS in a year.
 *
 * Gross, explicitly. This used to sum one untyped amount carried on the payslip
 * DOCUMENT, which the reader had filled from the slip's NET line — so the
 * prefill understated a tax statement's gross income by everything withheld,
 * and the divergence note fired on every correctly-entered statement. Salary
 * states gross and net as two fields now, and the document carries neither.
 *
 * A month evidenced only by a bank credit has a net figure and no gross. It
 * contributes neither an amount nor a month: the count is what tells the screen
 * how completely a year is evidenced, and counting a net-only month would
 * overstate that.
 */
export function salaryYearGrossTotal(
	months: SalaryGrossMonth[],
	personId: string,
	year: number
): { totalMinor: bigint; months: number } {
	const own = months.filter(
		(m) =>
			m.personId === personId && m.grossMinor !== null && Number(m.periodMonth.slice(0, 4)) === year
	);
	return {
		totalMinor: own.reduce((sum, m) => sum + (m.grossMinor ?? 0n), 0n),
		months: own.length
	};
}

export function salaryYearGrossTotalConverted(
	months: SalaryGrossMonth[],
	personId: string,
	year: number,
	targetCurrency: string,
	convert: (amount: bigint, from: string, to: string, day: string) => bigint
): { totalMinor: bigint; months: number } {
	const own = months.filter(
		(m) =>
			m.personId === personId && m.grossMinor !== null && Number(m.periodMonth.slice(0, 4)) === year
	);
	return {
		totalMinor: own.reduce(
			(sum, m) => sum + convert(m.grossMinor!, m.currency, targetCurrency, `${m.periodMonth}-01`),
			0n
		),
		months: own.length
	};
}

/** One series per person, country and currency — never merged or converted. */
export function taxSeries(statements: StatementLike[]): Series[] {
	const byKey = new Map<string, Series>();
	for (const s of statements) {
		const key = `${s.personId}|${s.country}|${s.currency}`;
		const series = byKey.get(key) ?? {
			key,
			label: `${s.personName} · ${s.country}`,
			currency: s.currency,
			points: []
		};
		series.points.push({
			year: s.year,
			grossMinor: s.grossIncomeMinor,
			taxMinor: s.taxPaidMinor,
			grossMajor: toMajor(s.grossIncomeMinor, s.currency),
			taxMajor: toMajor(s.taxPaidMinor, s.currency),
			ratePct: effectiveRatePct(s.grossIncomeMinor, s.taxPaidMinor)
		});
		byKey.set(key, series);
	}
	return [...byKey.values()]
		.map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.year - b.year) }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

export interface YearCountry {
	country: string;
	/** Converted to the display currency, minor units. */
	grossMinor: bigint;
	taxMinor: bigint;
	ratePct: number | null;
	/** The filed figures, untouched — for the expansion and the hover readout. */
	native: { currency: string; grossMinor: bigint; taxMinor: bigint }[];
}

export interface YearRow {
	year: number;
	/** One entry per jurisdiction that filed in this year. */
	byCountry: YearCountry[];
	grossMinor: bigint;
	taxMinor: bigint;
	ratePct: number | null;
}

/**
 * Statements regrouped on the axis they are READ on.
 *
 * Person·country is the axis they were ENTERED on. A household that has filed
 * in four jurisdictions over eight years sees one year in three separate places
 * under that grouping, so "what did 2024 cost me" becomes a question the layout
 * cannot answer.
 *
 * Conversion happens at YEAR END, never at today's rate. A yearly statement is
 * not a dated transaction; using today's rate for a 2018 filing restates
 * history every time the rate table updates, so last month's screenshot and
 * this month's disagree about a number neither of them changed.
 */
export function taxByYear(
	statements: StatementLike[],
	displayCurrency: string,
	convert: (amount: bigint, from: string, to: string, day: string) => bigint,
	personId?: string
): YearRow[] {
	const wanted = personId ? statements.filter((s) => s.personId === personId) : statements;

	const years = new Map<number, Map<string, YearCountry>>();
	for (const s of wanted) {
		const day = `${s.year}-12-31`;
		const countries = years.get(s.year) ?? new Map<string, YearCountry>();
		const existing = countries.get(s.country) ?? {
			country: s.country,
			grossMinor: 0n,
			taxMinor: 0n,
			ratePct: null,
			native: []
		};
		existing.grossMinor += convert(s.grossIncomeMinor, s.currency, displayCurrency, day);
		existing.taxMinor += convert(s.taxPaidMinor, s.currency, displayCurrency, day);
		// Both filings stay listed even though the cell adds them up: two people
		// filing in one country in one year is two statements, and the expansion
		// has to be able to show them apart.
		existing.native.push({
			currency: s.currency,
			grossMinor: s.grossIncomeMinor,
			taxMinor: s.taxPaidMinor
		});
		countries.set(s.country, existing);
		years.set(s.year, countries);
	}

	return [...years.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([year, countries]) => {
			// Sorted so a column does not change place between loads.
			const byCountry = [...countries.values()]
				.map((c) => ({ ...c, ratePct: effectiveRatePct(c.grossMinor, c.taxMinor) }))
				.sort((a, b) => a.country.localeCompare(b.country));
			const grossMinor = byCountry.reduce((sum, c) => sum + c.grossMinor, 0n);
			const taxMinor = byCountry.reduce((sum, c) => sum + c.taxMinor, 0n);
			return {
				year,
				byCountry,
				grossMinor,
				taxMinor,
				ratePct: effectiveRatePct(grossMinor, taxMinor)
			};
		});
}

/**
 * Lifetime rate, weighted by income — total tax over total gross across the
 * whole record, not a mean of the yearly percentages.
 *
 * A mean gives a 2018 filing of €924 the same vote as a 2025 filing of
 * €174 000, which is wrong by two orders of magnitude.
 */
export function blendedRatePct(rows: YearRow[]): number | null {
	const gross = rows.reduce((sum, r) => sum + r.grossMinor, 0n);
	const tax = rows.reduce((sum, r) => sum + r.taxMinor, 0n);
	return effectiveRatePct(gross, tax);
}

/**
 * Below this, a filing is too small to be a full year and the cell says so.
 *
 * Five per cent of the median filing rather than an amount: a threshold in
 * money would have to name a currency, and would go stale as the record grows.
 *
 * The median rather than the mean, because a mean moves toward the outliers —
 * enough tiny filings would drag the bar down until none of them is flagged,
 * which is exactly the wrong way round.
 */
export function flaggedThresholdMinor(rows: YearRow[]): bigint {
	const filings = rows
		.flatMap((r) => r.byCountry.map((c) => c.grossMinor))
		.filter((gross) => gross > 0n)
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	if (filings.length === 0) return 0n;
	const median = filings[Math.floor(filings.length / 2)];
	return median / 20n;
}
