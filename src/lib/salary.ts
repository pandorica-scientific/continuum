// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Salary tracking derived from payslips. Pure functions: amount and period
// detection over extracted text lines, and the year-by-year statistics. The
// keyword lists are format facts of real payslips (Czech and English), the
// same way bank statement markers are; everything person-specific is learned
// from corrections, never hard-coded.

import { minorDigits } from '$lib/money';

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
 * Gross wordings payslips actually print.
 *
 * A slip states gross AND net; they are two facts, not two readings of one
 * number, which is why `salary_entry` carries a column for each. Until v0.4.6
 * only the net list existed and whatever it found was filed as gross.
 *
 * Longer wordings come first: `pickBy` returns on the first keyword with any
 * hit, and "hrubá mzda" is a substring of "hrubá mzda celkem".
 */
const GROSS_PAY_KEYWORDS = [
	'hrubá mzda celkem',
	'hrubá měsíční mzda',
	'hrubá mzda',
	'hrubý příjem',
	'total gross',
	'gross earnings',
	'gross salary',
	'gross pay'
];

/**
 * Never gross, however much it looks like it.
 *
 * Czech slips print superhrubá mzda — total employment cost — above the gross
 * line, and it is larger. Excluded rather than merely ranked below gross,
 * because a slip can print the cost line and no gross line at all, and the old
 * largest-amount fallback would then have handed it over as the salary.
 */
const COST_KEYWORDS = [
	'superhrubá mzda',
	'cena práce',
	'cost of employment',
	'employer cost',
	'total cost'
];

/**
 * Does this label END at the keyword — is the amount the one printed next to it?
 *
 * The distinction that matters on a real payslip. `extractPdfLines` joins a
 * table row's cells with spaces, so one physical row arrives as one long line
 * carrying several amounts, and `extractCandidates` labels each amount with
 * everything before it on that line. Every column to the RIGHT of "Hrubá mzda"
 * therefore gets a label that still contains it:
 *
 *   "hrubá mzda"                                          =  70 135  ← gross
 *   "hrubá mzda 70 135 hod.vč.přesč. 176 sp zaměstnanec"   =   4 980  ← insurance
 *   "hrubá mzda 70 135 ... sp zaměstnanec 4 980 daň"       =  10 530  ← tax
 *
 * Only the first ends at the keyword.
 */
function endsAt(label: string, keyword: string): boolean {
	return fold(label).endsWith(fold(keyword));
}

/**
 * The candidate a list of wordings points at, or null.
 *
 * A learned label wins, then the amount printed NEXT TO a keyword, and only
 * then a looser match anywhere in the label. Excluded labels can never be
 * returned, whatever matched them.
 *
 * Tightness beats keyword rank: an exact hit on a later wording is a better
 * answer than a trailing-column hit on an earlier one, so both passes run over
 * the whole keyword list rather than resolving each keyword in turn.
 *
 * Within one pass the LAST match wins, because a slip that prints its
 * components before its total puts the total later.
 *
 * There is deliberately no "largest amount on the slip" fallback. It is what
 * filed net pay as gross for every slip with no matching wording, and pointed at
 * gross it would find total employment cost instead. Null is a question the form
 * can ask once and learn from; a wrong number is silent.
 */
function pickBy(
	candidates: AmountCandidate[],
	keywords: readonly string[],
	learnedLabel: string | null,
	exclude: readonly string[] = []
): AmountCandidate | null {
	const allowed = candidates.filter((c) => !exclude.some((k) => fold(c.label).includes(fold(k))));
	if (allowed.length === 0) return null;

	if (learnedLabel) {
		const learned = allowed.filter((c) => fold(c.label) === fold(learnedLabel));
		// the same label can appear more than once; the last is the total line
		if (learned.length > 0) return learned[learned.length - 1];
	}

	for (const match of [endsAt, (l: string, k: string) => fold(l).includes(fold(k))]) {
		for (const keyword of keywords) {
			const hits = allowed.filter((c) => match(c.label, keyword));
			if (hits.length > 0) return hits[hits.length - 1];
		}
	}
	return null;
}

export function pickGross(
	candidates: AmountCandidate[],
	learnedLabel: string | null
): AmountCandidate | null {
	return pickBy(candidates, GROSS_PAY_KEYWORDS, learnedLabel, COST_KEYWORDS);
}

export function pickNet(
	candidates: AmountCandidate[],
	learnedLabel: string | null
): AmountCandidate | null {
	return pickBy(candidates, NET_PAY_KEYWORDS, learnedLabel);
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
/**
 * Bonus wordings payslips actually print.
 *
 * Gross-side only, and deliberately short. A payslip itemises what makes up
 * gross; a bank credit is one net transfer with no components at all, so there
 * is no such thing as a net bonus to detect. Anything not matched here stays
 * part of the base rather than being guessed at.
 */
const BONUS_KEYWORDS = [
	'mimořádná odměna',
	'mimoradna odmena',
	'prémie',
	'premie',
	'odměna',
	'odmena',
	'13. plat',
	'13 plat',
	'performance bonus',
	'annual bonus',
	'bonus'
];

/**
 * What of this slip's gross was a bonus, or null when it says nothing.
 *
 * Null and zero are different answers: null is "the slip did not itemise one",
 * zero would be "it stated there was none". Only the first is honest about a
 * plain slip.
 *
 * Several lines are summed — a month can carry a standing premium and a one-off
 * award separately, and reporting the first alone understates it.
 *
 * `learnedLabel` wins over the keywords, the same way the pay amount's learned
 * label does: a correction teaches the reader rather than being re-entered
 * every month.
 */
export function detectBonus(
	candidates: AmountCandidate[],
	learnedLabels: string[] | null = null
): bigint | null {
	const matches = (label: string, needle: string): boolean => {
		const haystack = fold(label);
		const target = fold(needle);
		const at = haystack.indexOf(target);
		if (at === -1) return false;
		// Whole word only: "bonusový program poplatek" is a fee, not a bonus.
		const after = haystack[at + target.length];
		return after === undefined || !/[\p{L}\p{N}]/u.test(after);
	};

	// One line can match two keywords ("mimořádná odměna" also contains
	// "odměna"); dedupe by the label it was found on so it is not counted twice.
	const sum = (hits: AmountCandidate[]): bigint => {
		const seen = new Set<string>();
		let total = 0n;
		for (const hit of hits) {
			const key = `${hit.label}|${hit.amountMinor}`;
			if (seen.has(key)) continue;
			seen.add(key);
			total += hit.amountMinor;
		}
		return total;
	};

	if (learnedLabels && learnedLabels.length > 0) {
		const exact = candidates.filter((c) => learnedLabels.some((l) => endsAt(c.label, l)));
		if (exact.length > 0) return sum(exact);
		const learned = candidates.filter((c) => learnedLabels.some((l) => matches(c.label, l)));
		if (learned.length > 0) return sum(learned);
	}

	// Tight first, for the same reason pickBy does it: on a joined table row every
	// column right of "AIP bonus" keeps a label containing it, so summing every
	// match added the tax columns to the award — 65 251 became 367 766, larger
	// than the gross it was supposedly part of.
	const tight = candidates.filter((c) => BONUS_KEYWORDS.some((k) => endsAt(c.label, k)));
	if (tight.length > 0) return sum(tight);

	const hits = candidates.filter((c) => BONUS_KEYWORDS.some((k) => matches(c.label, k)));
	if (hits.length === 0) return null;
	return sum(hits);
}

/**
 * The backstop for a slip that itemises an implausible number of awards. The
 * search below is exponential in the pool size, and the pool is normally two
 * or three lines.
 */
const SUBSET_CAP = 12;

/**
 * Which bonus lines add up to the total somebody typed.
 *
 * A correction states one number; the slip may have reached it from two lines,
 * and learning has to name both or it learns nothing. Matching a single
 * candidate on equality was the v0.4.5 contract, which meant a two-line bonus
 * could never be learned — silently, on exactly the months worth correcting.
 *
 * The search is over the BONUS-KEYWORD lines only, never every amount on the
 * slip, so a total that happens to equal gross cannot be "explained" by the
 * gross line. The smallest matching set wins: fewer labels learned means fewer
 * wrong lines swept up next month.
 */
export function bonusLabelSubset(candidates: AmountCandidate[], total: bigint): string[] | null {
	const named = candidates.filter((c) => c.label.length > 0);
	// Same tight-first rule as detectBonus. A pool holding a row's tax columns
	// lets the subset search "explain" a stated total out of the wrong lines.
	const tight = named.filter((c) => BONUS_KEYWORDS.some((k) => endsAt(c.label, k)));
	const loose = named.filter((c) => BONUS_KEYWORDS.some((k) => fold(c.label).includes(fold(k))));
	const pool = (tight.length > 0 ? tight : loose).slice(0, SUBSET_CAP);
	if (pool.length === 0) return null;

	let best: string[] | null = null;
	for (let mask = 1; mask < 1 << pool.length; mask++) {
		let sum = 0n;
		const labels: string[] = [];
		for (let i = 0; i < pool.length; i++) {
			if (mask & (1 << i)) {
				sum += pool[i].amountMinor;
				labels.push(pool[i].label);
			}
		}
		if (sum !== total) continue;
		if (best === null || labels.length < best.length) best = labels;
	}
	return best ? [...new Set(best)] : null;
}

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

/**
 * Symbols payslips print instead of an ISO code.
 *
 * A format fact of real slips, exactly like the month names above: a Czech slip
 * prints "Kč" and never "CZK", and an exporter that strips diacritics prints
 * "Kc". Deliberately short — a mark that names more than one currency ("kr" is
 * Swedish, Norwegian and Danish) teaches nothing, and a wrong currency is worse
 * than asking.
 */
const CURRENCY_MARKS: Record<string, readonly string[]> = {
	CZK: ['kč', 'kc'],
	EUR: ['€'],
	USD: ['$'],
	GBP: ['£'],
	PLN: ['zł', 'zl'],
	CHF: ['chf']
};

function escapeRe(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How often a mark appears, as a whole word where the mark is made of letters. */
function markHits(text: string, mark: string): number {
	const letters = /\p{L}/u.test(mark);
	const pattern = letters ? `(?<!\\p{L})${escapeRe(mark)}(?!\\p{L})` : escapeRe(mark);
	return text.match(new RegExp(pattern, 'gu'))?.length ?? 0;
}

/**
 * Which currency a payslip is printed in, or null when it does not say plainly.
 *
 * The currency of a payslip is a fact about the slip. It was taken from the
 * household's base currency until v0.5.1, which is right only when the two
 * happen to agree: a Czech slip filed by a household keeping its books in euro
 * was stored as 135 887 EUR, and every conversion downstream then multiplied a
 * koruna figure by the euro rate.
 *
 * Restricted to `allowed` — the currencies the app can actually convert — so a
 * mark for a currency with no rate never becomes an answer. A tie returns null
 * rather than a guess: the form asks, and what a person states is a decision.
 */
export function detectCurrency(
	lines: readonly string[],
	allowed: readonly string[]
): string | null {
	const text = lines.join('\n').toLowerCase();
	const counts: { code: string; hits: number }[] = [];
	for (const code of allowed) {
		if (!/^[A-Za-z]{3}$/.test(code)) continue;
		let hits = markHits(text, code.toLowerCase());
		for (const mark of CURRENCY_MARKS[code.toUpperCase()] ?? []) hits += markHits(text, mark);
		if (hits > 0) counts.push({ code, hits });
	}
	if (counts.length === 0) return null;
	counts.sort((a, b) => b.hits - a.hits);
	// Two currencies named equally often is a slip that has not said which it is.
	if (counts.length > 1 && counts[1].hits === counts[0].hits) return null;
	return counts[0].code;
}

export interface SalaryYear {
	year: number;
	/** age that year, when the birth year is known */
	age: number | null;
	/**
	 * Average monthly GROSS, over the months that have one.
	 *
	 * Gross and net are kept apart rather than averaged together, and this is the
	 * whole point of the pair. A payslip states gross; a bank credit is net. A
	 * year with payslips for four months and bank credits for twelve would
	 * otherwise average four gross figures with eight net ones and call the
	 * result a salary — a number that is neither, and lower than the truth.
	 */
	grossAvgMinor: bigint | null;
	grossMonths: number;
	/** Average monthly NET, over the months that have one. */
	netAvgMinor: bigint | null;
	netMonths: number;
	/** The year's gross months added up, and the same split base against bonus. */
	grossTotalMinor: bigint;
	bonusTotalMinor: bigint;
	baseTotalMinor: bigint;
	/** The year's net months added up — what actually landed in the account. */
	netTotalMinor: bigint;
	/**
	 * Whether the net total covers a whole year.
	 *
	 * An annual total over three months is not a small year, it is a partial
	 * one, and beside a complete year it reads as a collapse. The screen marks
	 * it rather than hiding it or quietly annualising it.
	 */
	netComplete: boolean;
	/**
	 * Year-on-year change in the BASE, apart from the change in the total.
	 *
	 * A one-off bonus moves the total up one year and down the next, which reads
	 * as a raise followed by a pay cut when neither happened. The base answers
	 * what the salary did.
	 */
	baseDeltaPct: number | null;
	/** Whichever of the two the year is best evidenced by, for the chart. */
	avgMonthlyMinor: bigint;
	/** How many months that figure came from. */
	months: number;
	/** Whether `avgMonthlyMinor` is gross. Net is not comparable to it. */
	avgIsGross: boolean;
	/** average vs the previous listed year, in percent — like against like */
	deltaPct: number | null;
}

/** One month's salary, from a payslip, a bank credit, or both. */
export interface SalaryMonth {
	periodMonth: string;
	grossMinor?: bigint | null;
	netMinor?: bigint | null;
	/** The part of gross the payslip itemised as a bonus. Gross-side only. */
	bonusMinor?: bigint | null;
}

/**
 * Average monthly salary per year, gross and net kept apart.
 *
 * Salary reaches this from two places now: a payslip, which states GROSS, and a
 * salary credit on a bank statement, which is NET. They are not competing
 * readings of one number and neither wins — a month can carry both, and a year
 * reports each over the months that actually have it.
 *
 * `avgMonthlyMinor` is the series the chart draws, and it takes whichever half
 * the year is better evidenced by, saying which via `avgIsGross`. The
 * year-on-year change is only computed between years of the SAME kind: gross
 * against net would report a pay cut where somebody simply started uploading
 * payslips.
 */
export function salaryStats(months: SalaryMonth[], birthYear: number | null): SalaryYear[] {
	const byYear = new Map<number, { gross: bigint[]; net: bigint[]; bonus: bigint }>();
	for (const month of months) {
		const year = Number(month.periodMonth.slice(0, 4));
		if (!Number.isInteger(year)) continue;
		if (!byYear.has(year)) byYear.set(year, { gross: [], net: [], bonus: 0n });
		const bucket = byYear.get(year)!;
		if (month.grossMinor !== null && month.grossMinor !== undefined) {
			bucket.gross.push(month.grossMinor);
		}
		if (month.netMinor !== null && month.netMinor !== undefined) {
			bucket.net.push(month.netMinor);
		}
		// Null is "the slip did not itemise one", which contributes nothing —
		// distinct from a slip that stated zero, which also contributes nothing
		// but means something different to the reader looking at the month.
		if (month.bonusMinor) bucket.bonus += month.bonusMinor;
	}

	const mean = (values: bigint[]): bigint | null =>
		values.length ? values.reduce((sum, v) => sum + v, 0n) / BigInt(values.length) : null;

	const rows: SalaryYear[] = [];
	for (const year of [...byYear.keys()].sort()) {
		const { gross, net, bonus } = byYear.get(year)!;
		if (gross.length === 0 && net.length === 0) continue;

		const grossTotal = gross.reduce((sum, v) => sum + v, 0n);
		const netTotal = net.reduce((sum, v) => sum + v, 0n);
		// Clamped: a misread bonus line, or a slip whose gross excludes the
		// award, must not draw a negative base.
		const baseTotal = grossTotal > bonus ? grossTotal - bonus : 0n;

		const grossAvg = mean(gross);
		const netAvg = mean(net);
		// Gross when the year has any, because it is the figure a salary is
		// normally quoted as — and the one comparable across employers.
		const avgIsGross = grossAvg !== null;
		const avg = (avgIsGross ? grossAvg : netAvg) as bigint;
		const monthCount = avgIsGross ? gross.length : net.length;

		// Like against like. The previous LISTED year may be of the other kind,
		// which is exactly the case that would invent a pay cut.
		const prev = rows[rows.length - 1];
		const comparable = prev && prev.avgIsGross === avgIsGross && prev.avgMonthlyMinor > 0n;
		// Base against base, over the same number of months, so the comparison is
		// of monthly pay rather than of how many months were recorded.
		const baseAvg = gross.length > 0 ? baseTotal / BigInt(gross.length) : null;
		const prevBaseAvg =
			prev && prev.grossMonths > 0 ? prev.baseTotalMinor / BigInt(prev.grossMonths) : null;

		rows.push({
			year,
			age: birthYear ? year - birthYear : null,
			grossAvgMinor: grossAvg,
			grossMonths: gross.length,
			netAvgMinor: netAvg,
			netMonths: net.length,
			grossTotalMinor: grossTotal,
			bonusTotalMinor: bonus,
			baseTotalMinor: baseTotal,
			netTotalMinor: netTotal,
			netComplete: net.length >= 12,
			baseDeltaPct:
				baseAvg !== null && prevBaseAvg !== null && prevBaseAvg > 0n
					? Math.round((Number(baseAvg) / Number(prevBaseAvg) - 1) * 1000) / 10
					: null,
			avgMonthlyMinor: avg,
			months: monthCount,
			avgIsGross,
			deltaPct: comparable
				? Math.round((Number(avg) / Number(prev.avgMonthlyMinor) - 1) * 1000) / 10
				: null
		});
	}
	return rows;
}

/**
 * Every person's years added into one household series.
 *
 * The Salary screen offers a "Both" view the way the Tax screen does, and the
 * arithmetic has to be done on the TOTALS rather than on the per-person
 * averages. Averaging two averages weights a person paid for two months the
 * same as one paid for twelve, and reports a household monthly figure neither
 * of them earned.
 *
 * The two comparisons are recomputed from the merged series for the same
 * reason: a delta carried over from one person's row would describe that
 * person, under a label saying it described the household.
 */
export function mergeSalaryYears(perPerson: SalaryYear[][]): SalaryYear[] {
	const byYear = new Map<number, SalaryYear[]>();
	for (const person of perPerson) {
		for (const row of person) {
			byYear.set(row.year, [...(byYear.get(row.year) ?? []), row]);
		}
	}

	const rows: SalaryYear[] = [];
	for (const year of [...byYear.keys()].sort((a, b) => a - b)) {
		const parts = byYear.get(year)!;
		const total = (pick: (r: SalaryYear) => bigint) => parts.reduce((sum, r) => sum + pick(r), 0n);

		const grossTotal = total((r) => r.grossTotalMinor);
		const netTotal = total((r) => r.netTotalMinor);
		const bonusTotal = total((r) => r.bonusTotalMinor);
		const baseTotal = total((r) => r.baseTotalMinor);
		const grossMonths = parts.reduce((n, r) => n + r.grossMonths, 0);
		const netMonths = parts.reduce((n, r) => n + r.netMonths, 0);

		const grossAvg = grossMonths > 0 ? grossTotal / BigInt(grossMonths) : null;
		const netAvg = netMonths > 0 ? netTotal / BigInt(netMonths) : null;
		const avgIsGross = grossAvg !== null;
		const avg = (avgIsGross ? grossAvg : netAvg) ?? 0n;

		// Like against like, exactly as salaryStats does it: the previous listed
		// year may be of the other kind, which is the case that invents a pay cut.
		const prev = rows[rows.length - 1];
		const comparable = prev && prev.avgIsGross === avgIsGross && prev.avgMonthlyMinor > 0n;
		const baseAvg = grossMonths > 0 ? baseTotal / BigInt(grossMonths) : null;
		const prevBaseAvg =
			prev && prev.grossMonths > 0 ? prev.baseTotalMinor / BigInt(prev.grossMonths) : null;

		rows.push({
			year,
			// A household has no single age. The chart's age axis is a per-person
			// reading and stays absent here rather than picking somebody's.
			age: null,
			grossAvgMinor: grossAvg,
			grossMonths,
			netAvgMinor: netAvg,
			netMonths,
			grossTotalMinor: grossTotal,
			bonusTotalMinor: bonusTotal,
			baseTotalMinor: baseTotal,
			netTotalMinor: netTotal,
			// Complete only when EVERY contributor's year was: one person's partial
			// year makes the household total partial too, however many months the
			// other one covered.
			netComplete: parts.length > 0 && parts.every((r) => r.netComplete),
			baseDeltaPct:
				baseAvg !== null && prevBaseAvg !== null && prevBaseAvg > 0n
					? Math.round((Number(baseAvg) / Number(prevBaseAvg) - 1) * 1000) / 10
					: null,
			avgMonthlyMinor: avg,
			months: avgIsGross ? grossMonths : netMonths,
			avgIsGross,
			deltaPct: comparable
				? Math.round((Number(avg) / Number(prev.avgMonthlyMinor) - 1) * 1000) / 10
				: null
		});
	}
	return rows;
}

/**
 * The most recent year the BASE actually rose, or null.
 *
 * Base rather than total, because a one-off bonus lifts the total one year and
 * drops it the next — which reads as a raise followed by a pay cut when neither
 * happened. `baseDeltaPct` already has the bonus taken out.
 *
 * A fall is not an increase and neither is standing still: both return the last
 * real rise, or null. Calling the latest CHANGE an increase would put a red
 * figure under a green label.
 */
export function lastBaseIncrease(years: SalaryYear[]): { year: number; pct: number } | null {
	const risen = years.filter((y) => y.baseDeltaPct !== null && y.baseDeltaPct > 0);
	if (risen.length === 0) return null;
	const latest = risen.reduce((newest, y) => (y.year > newest.year ? y : newest));
	return { year: latest.year, pct: latest.baseDeltaPct! };
}
