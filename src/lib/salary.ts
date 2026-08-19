// Salary tracking derived from payslips. Pure functions: amount and period
// detection over extracted text lines, and the year-by-year statistics. The
// keyword lists are format facts of real payslips (Czech and English), the
// same way bank statement markers are; everything person-specific is learned
// from corrections, never hard-coded.

import { minorDigits } from '$lib/money';

/** Corrections keep the unit the payslip was stored in. The household base
 * may change later, but that must never redenominate historical salary. */
export function payslipEditCurrency(
	storedCurrency: string | null,
	currentBaseCurrency: string
): string {
	return storedCurrency ?? currentBaseCurrency;
}

export interface AmountCandidate {
	/** the text on the line before the amount, lowercased — the amount's label */
	label: string;
	amountMinor: bigint;
}

// Net-pay wordings payslips actually print. Ordered: an earlier match wins.
const NET_PAY_KEYWORDS = [
	'k výplatě',
	'k vyplacení',
	'celkem k výplatě',
	'čistá mzda',
	'dobírka',
	'převod na účet',
	'net pay',
	'net salary',
	'take home',
	'amount paid'
];

// Two printing conventions, both of which real payslips use. The comma-grouped
// alternative comes first and has to: without it "45,231.00" fell through to
// the bare `\d{1,3}[.,]\d{2}` tail and matched its first four characters, so an
// English payslip was filed as 45.23 instead of 45 231 — silently, with no
// throw and no null, straight into the salary history and the tax prefill.
// NET_PAY_KEYWORDS carries "net pay", "take home" and "amount paid", so English
// payslips are an intended input and comma-grouped thousands are how they print.
const AMOUNT_RE =
	/\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{1,3}(?:[\u00A0\u202F .]\d{3})+(?:[.,]\d{2})?|\d{4,9}(?:[.,]\d{2})?|\d{1,3}[.,]\d{2}/g;

/**
 * Parse a printed amount to minor units: "45 231,00", "45.231" and "45231.00"
 * in the European form, "45,231.00" and "1,234,567.89" in the English one.
 */
export function parsePrintedAmount(raw: string, currency: string): bigint | null {
	const cleaned = raw.replace(/[\s\u00A0\u202F]/g, '');
	const digits = minorDigits(currency);

	const toMinor = (whole: string, fraction?: string): bigint | null => {
		if (!/^\d+$/.test(whole)) return null;
		try {
			// Scaled by the currency's own minor units, not a fixed 100: the
			// amount a person types into the payslip form is parsed by
			// parseAmountToMinor, and learnAmountLabel compares the two for
			// equality — a fixed 100 here meant that comparison could never
			// match in a currency without exactly two minor units, so the
			// reader silently never learned the label.
			const scaled = BigInt(whole) * 10n ** BigInt(digits);
			if (digits === 0) return scaled;
			return scaled + BigInt((fraction ?? '').padEnd(digits, '0').slice(0, digits) || '0');
		} catch {
			return null;
		}
	};

	// Comma-grouped thousands with a dot decimal. Unambiguous: a comma followed
	// by exactly three digits is never a decimal separator.
	const english = cleaned.match(/^(\d{1,3}(?:,\d{3})+)(?:\.(\d{2}))?$/);
	if (english) return toMinor(english[1].replace(/,/g, ''), english[2]);

	// European form: a trailing ,dd or .dd is the decimal, everything else groups.
	const m = cleaned.match(/^(\d+(?:\.\d{3})*|\d+)(?:[.,](\d{2}))?$/);
	if (!m) return null;
	return toMinor(m[1].replace(/\./g, ''), m[2]);
}

/** Every amount on every line, labelled by the text before it. */
export function extractCandidates(lines: string[], currency: string): AmountCandidate[] {
	const out: AmountCandidate[] = [];
	for (const line of lines) {
		for (const match of line.matchAll(AMOUNT_RE)) {
			const amountMinor = parsePrintedAmount(match[0], currency);
			if (amountMinor === null || amountMinor <= 0n) continue;
			out.push({
				label: line
					.slice(0, match.index)
					.trim()
					.toLowerCase()
					.replace(/[:\s]+$/, '')
					.slice(-60),
				amountMinor
			});
		}
	}
	return out;
}

/** Fold diacritics — payslips print "K výplatě" or "K vyplate" depending on the exporter. */
function fold(text: string): string {
	return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Pick the payslip's pay amount: a learned label wins, then the net-pay
 * keywords in order, then the largest amount on the slip as a last resort.
 * All label matching is diacritics-insensitive.
 */
export function pickAmount(
	candidates: AmountCandidate[],
	learnedLabel: string | null
): AmountCandidate | null {
	if (candidates.length === 0) return null;
	if (learnedLabel) {
		const learned = candidates.filter((c) => fold(c.label) === fold(learnedLabel));
		// the same label can appear more than once; the last is the total line
		if (learned.length > 0) return learned[learned.length - 1];
	}
	for (const keyword of NET_PAY_KEYWORDS) {
		const hits = candidates.filter((c) => fold(c.label).includes(fold(keyword)));
		if (hits.length > 0) return hits[hits.length - 1];
	}
	return candidates.reduce((max, c) => (c.amountMinor > max.amountMinor ? c : max));
}

const MONTHS: Record<string, number> = {
	// Czech month names, including the genitive forms payslips print
	leden: 1,
	ledna: 1,
	únor: 2,
	února: 2,
	březen: 3,
	března: 3,
	duben: 4,
	dubna: 4,
	květen: 5,
	května: 5,
	červen: 6,
	června: 6,
	červenec: 7,
	července: 7,
	srpen: 8,
	srpna: 8,
	září: 9,
	říjen: 10,
	října: 10,
	listopad: 11,
	listopadu: 11,
	prosinec: 12,
	prosince: 12,
	january: 1,
	february: 2,
	march: 3,
	april: 4,
	may: 5,
	june: 6,
	july: 7,
	august: 8,
	september: 9,
	october: 10,
	november: 11,
	december: 12
};

/** The month a payslip covers: "08/2026", "2026-08" or "srpen 2026". */
export function detectPeriod(lines: string[]): string | null {
	for (const line of lines) {
		const numeric = line.match(/\b(0?[1-9]|1[0-2])\s*[/.]\s*(20\d{2})\b/);
		if (numeric) return `${numeric[2]}-${numeric[1].padStart(2, '0')}`;
		const iso = line.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
		if (iso) return `${iso[1]}-${iso[2]}`;
		const lower = line.toLowerCase();
		for (const [name, month] of Object.entries(MONTHS)) {
			// Unicode letter boundaries, not \b. JavaScript defines \b over
			// [A-Za-z0-9_] only, so between a space and "ú" there is no boundary
			// at all and `\búnor\b` could never match: 9 of the 23 names here —
			// únor, února, červen, června, červenec, července, září, říjen, října
			// — silently failed, so February, June, July, September and October
			// payslips stored periodMonth null and dropped out of both the salary
			// chart and the tax gross prefill.
			const named = lower.match(new RegExp(`(?<!\\p{L})${name}(?!\\p{L})\\s*(20\\d{2})`, 'u'));
			if (named) return `${named[1]}-${String(month).padStart(2, '0')}`;
		}
	}
	return null;
}

interface SalaryYear {
	year: number;
	/** age that year, when the birth year is known */
	age: number | null;
	avgMonthlyMinor: bigint;
	months: number;
	/** average vs the previous listed year, in percent */
	deltaPct: number | null;
}

/** Average monthly salary per year and the year-on-year change. */
export function salaryStats(
	slips: { periodMonth: string; amountMinor: bigint }[],
	birthYear: number | null
): SalaryYear[] {
	const byYear = new Map<number, bigint[]>();
	for (const slip of slips) {
		const year = Number(slip.periodMonth.slice(0, 4));
		if (!Number.isInteger(year)) continue;
		if (!byYear.has(year)) byYear.set(year, []);
		byYear.get(year)!.push(slip.amountMinor);
	}
	const years = [...byYear.keys()].sort();
	const rows: SalaryYear[] = [];
	for (const year of years) {
		const amounts = byYear.get(year)!;
		const avg = amounts.reduce((s, a) => s + a, 0n) / BigInt(amounts.length);
		const prev = rows[rows.length - 1];
		rows.push({
			year,
			age: birthYear ? year - birthYear : null,
			avgMonthlyMinor: avg,
			months: amounts.length,
			deltaPct:
				prev && prev.avgMonthlyMinor > 0n
					? Math.round((Number(avg) / Number(prev.avgMonthlyMinor) - 1) * 1000) / 10
					: null
		});
	}
	return rows;
}
