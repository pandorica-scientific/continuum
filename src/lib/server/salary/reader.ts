// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Pull the text out of an uploaded payslip PDF, pick its gross, net and bonus,
// and remember which label each correction pointed at so the next slip for the
// same person reads itself.
//
// Its own module rather than sitting in `index.ts`: reading a slip is a job of
// its own, and keeping it apart from how salary is RECORDED is what stopped the
// two importing each other.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { db, type Db } from '$lib/server/db';
import { extractPdfLines } from '$lib/server/import/pdftext';
import { getBaseCurrency, getSetting, setSetting } from '$lib/server/settings';
import { availableCurrencies } from '$lib/server/fx/currencies';
import {
	bonusLabelOnSlip,
	bonusLabelSubset,
	detectBonus,
	columnCandidates,
	detectCurrency,
	detectPeriod,
	payslipCurrency,
	extractCandidates,
	pickGross,
	learnedList,
	pickNet,
	tightestLabelFor,
	type AmountCandidate,
	type CurrencySource
} from '$lib/salary';

export interface PayslipReading {
	/** What the slip states as gross, or null when it names no gross line. */
	grossMinor: bigint | null;
	/** What the slip states as net, or null when it names no net line. */
	netMinor: bigint | null;
	/** What of gross the slip itemised as a bonus, or null if it said nothing. */
	bonusMinor: bigint | null;
	periodMonth: string | null;
	/**
	 * The currency the slip is printed in, or null when nothing knows.
	 *
	 * Null is not "the base currency". It is the form's cue to ask, and the
	 * asking is the point: taking the household's base currency for the answer
	 * is what filed six Czech payslips as euro.
	 */
	currency: string | null;
	/**
	 * How that currency was arrived at, so the form can say which.
	 *
	 * "Read from the slip" and "the same as the last one you filed" are
	 * different claims and deserve different words — the second is a good guess
	 * about an employer that has not changed, not a fact printed on the paper.
	 */
	currencyFrom: CurrencySource;
	candidates: AmountCandidate[];
}

/** How many wordings one person keeps. Jobs, not months. */
const LEARNED_LABEL_LIMIT = 6;

const EMPTY: PayslipReading = {
	grossMinor: null,
	netMinor: null,
	bonusMinor: null,
	periodMonth: null,
	currency: null,
	currencyFrom: null,
	candidates: []
};

// Values written before v0.5.2 are a bare string: one wording per person, which
// is what made a second employer wipe the first. Read as a one-item list and
// rewritten as a list by the next correction — no migration, because a person
// with one job has nothing to migrate.
function asLists(stored: Record<string, string | string[]>): Record<string, string[]> {
	return Object.fromEntries(
		Object.entries(stored).map(([key, value]) => [key, learnedList(value)])
	);
}

/**
 * Gross and net labels are learned under their OWN keys.
 *
 * One shared key was the v0.4.5 arrangement, and with the reader preferring net
 * wordings it meant a person's learned label was always a net one — while
 * everything downstream filed what it found as gross.
 */
async function learnedGrossLabels(): Promise<Record<string, string[]>> {
	return asLists(await getSetting<Record<string, string | string[]>>('payslipGrossLabels', {}));
}

/**
 * Net labels, seeded from the pre-v0.4.6 `payslipLabels`.
 *
 * That key's values are net wordings — `pickAmount` ranked by NET_PAY_KEYWORDS —
 * so carrying them over as net is the truthful reading of what was learned.
 * Read-through rather than a migration write: the next correction replaces the
 * entry under the new key anyway, and the current key wins where both exist.
 */
async function learnedNetLabels(): Promise<Record<string, string[]>> {
	const [current, legacy] = await Promise.all([
		getSetting<Record<string, string | string[]>>('payslipNetLabels', {}),
		getSetting<Record<string, string | string[]>>('payslipLabels', {})
	]);
	return asLists({ ...legacy, ...current });
}

/**
 * Bonus labels are learned under their own key, as a LIST.
 *
 * Sharing the pay key would let a bonus correction overwrite the pay label for
 * the same person — and the next slip would then file its bonus as the month's
 * pay. A list rather than one string because a month's bonus is routinely two
 * lines, and naming only one of them under-reads it next month.
 */
async function learnedBonusLabels(handle: Db = db): Promise<Record<string, string[]>> {
	const stored = await getSetting<Record<string, string | string[]>>(
		'payslipBonusLabels',
		{},
		handle
	);
	// Values written before v0.4.6 are a bare string. Read, never rewritten:
	// the next correction replaces the entry with a list anyway.
	return asLists(stored);
}

/**
 * The currency each person's payslips were last stated to be in.
 *
 * The same bargain as the learned labels above: a correction teaches the reader
 * so the next slip does not have to be corrected again. It matters more here
 * than it looks — plenty of payslips print their amounts with no currency
 * anywhere on the page, and without this the field has to be answered by hand
 * every single month for a job that has not changed.
 *
 * Keyed by name, like the label settings, because that is what the reader is
 * given; the link to the row is by id.
 */
async function learnedCurrencies(handle: Db = db): Promise<Record<string, string>> {
	return getSetting<Record<string, string>>('payslipCurrencies', {}, handle);
}

/**
 * Remember the currency a person stated for their payslip.
 *
 * Only ever called with a currency somebody CHOSE. A currency the reader put in
 * the field for them to look at teaches it nothing — it would be learning its
 * own answer back, which is the same rule the figures follow.
 */
export async function learnPayslipCurrency(
	subject: string,
	currency: string,
	handle: Db = db
): Promise<void> {
	const known = await learnedCurrencies(handle);
	known[subject.toLowerCase()] = currency;
	await setSetting('payslipCurrencies', known, handle);
}

/** Read a payslip PDF: gross, net, bonus, the month, and every candidate line. */
export async function readPayslip(data: Uint8Array, subject: string): Promise<PayslipReading> {
	let rows: Awaited<ReturnType<typeof extractPdfLines>>;
	try {
		rows = await extractPdfLines(data);
	} catch {
		return EMPTY;
	}
	const lines = rows.map((l) => l.cells.join(' '));
	// The currency comes first: `extractCandidates` scales printed amounts by the
	// currency's own minor units, so parsing before knowing which currency it is
	// would be reading the digits under the wrong rule.
	//
	// What the slip says beats what this person's last slip said, which beats
	// nothing at all. The learned value is a good guess about an employer that
	// has not changed; it never overrules a currency actually printed on the page.
	const key = subject.toLowerCase();
	// Everything that does not depend on the slip is read at once. These five
	// settings queries have no dependency on each other and awaiting them in
	// turn put five serialized round trips in front of every upload — sixty for
	// a twelve-slip drop, before a single PDF had been looked at.
	const [currencies, base, gross, net, bonus] = await Promise.all([
		availableCurrencies(),
		getBaseCurrency(),
		learnedGrossLabels(),
		learnedNetLabels(),
		learnedBonusLabels()
	]);
	const detected = detectCurrency(lines, currencies);
	const learned = detected ? null : ((await learnedCurrencies())[key] ?? null);
	const { currency, from: currencyFrom } = payslipCurrency(detected, learned);
	// The base currency is a PARSING fallback and nothing more. When neither the
	// slip nor the learner knows, the reading still reports `currency: null` so
	// the form asks instead of filing a guess nobody was shown.
	const parseAs = currency ?? base;
	const inline = extractCandidates(lines, parseAs);
	/**
	 * Amounts labelled by the heading over their column, for the payrolls that
	 * print a payslip as a real table.
	 *
	 * Merged with the line-at-a-time reading rather than held behind it, and the
	 * ORDER is what settles precedence: `pickBy` tries an exact wording before a
	 * loose one, so tight evidence wins whichever pass found it, while putting
	 * the same-line candidates last lets them take any tie.
	 *
	 * Keeping the column pass as a pure fallback looked safer and was not. A
	 * loose match on a line of IBAN digits is still a match, so the fallback
	 * never ran, and five payslips were read as 1,00 while the heading printed
	 * directly under the real figure went unlooked at.
	 */
	const candidates = [...columnCandidates(rows, parseAs), ...inline];

	return {
		grossMinor: pickGross(candidates, gross[key] ?? null)?.amountMinor ?? null,
		netMinor: pickNet(candidates, net[key] ?? null)?.amountMinor ?? null,
		bonusMinor: detectBonus(candidates, bonus[key] ?? null),
		periodMonth: detectPeriod(lines),
		currency,
		currencyFrom,
		candidates
	};
}

/**
 * The user stated a figure; if it matches a line on the slip, remember that
 * line's label for this person — the correction teaches the reader.
 */
async function learnLabel(
	key: 'payslipGrossLabels' | 'payslipNetLabels',
	subject: string,
	amountMinor: bigint,
	candidates: AmountCandidate[],
	handle: Db = db
): Promise<void> {
	// The tightest label, not the last one on the row. Taking the last learned
	// "gross salary 189 294 income tax base" — a wording carrying January's own
	// figure, which February's slip never prints.
	const hit = tightestLabelFor(candidates, amountMinor);
	if (!hit) return;
	const labels = asLists(await getSetting<Record<string, string | string[]>>(key, {}, handle));
	const person = subject.toLowerCase();
	// Newest first, and never twice. The one just confirmed goes to the front so
	// that on the rare slip where two learned wordings both match, the employer
	// most recently corrected wins.
	const kept = [hit.label, ...(labels[person] ?? []).filter((l) => l !== hit.label)];
	// A person does not hold down an unbounded number of jobs, and a wording not
	// seen in the last few corrections is not coming back.
	labels[person] = kept.slice(0, LEARNED_LABEL_LIMIT);
	await setSetting(key, labels, handle);
}

export async function learnGrossLabel(
	subject: string,
	grossMinor: bigint,
	candidates: AmountCandidate[],
	handle: Db = db
): Promise<void> {
	await learnLabel('payslipGrossLabels', subject, grossMinor, candidates, handle);
}

export async function learnNetLabel(
	subject: string,
	netMinor: bigint,
	candidates: AmountCandidate[],
	handle: Db = db
): Promise<void> {
	await learnLabel('payslipNetLabels', subject, netMinor, candidates, handle);
}

/**
 * The user stated the bonus; remember every label that adds up to it.
 *
 * Matching a single candidate on equality was the v0.4.5 contract, and it meant
 * a two-line bonus could never be learned — which is most of the months a
 * person would bother correcting.
 */
export async function learnBonusLabel(
	subject: string,
	bonusMinor: bigint,
	candidates: AmountCandidate[],
	handle: Db = db
): Promise<void> {
	const found = bonusLabelSubset(candidates, bonusMinor);
	if (!found || found.length === 0) return;
	const labels = await learnedBonusLabels(handle);
	const person = subject.toLowerCase();
	// Wordings that appear on THIS slip are what the correction just restated, so
	// they are replaced outright — keeping them would re-add a line the person
	// has only now said is not part of the award. Wordings that appear nowhere on
	// it belong to some other payroll and are kept, which is what stops a second
	// employer from wiping the first.
	const elsewhere = (labels[person] ?? []).filter(
		(label) => !candidates.some((c) => bonusLabelOnSlip(c.label, label))
	);
	labels[person] = [...found, ...elsewhere].slice(0, LEARNED_LABEL_LIMIT);
	await setSetting('payslipBonusLabels', labels, handle);
}

/** Re-read a stored payslip file (for corrections made after upload). */
export async function readStoredPayslip(
	storedName: string,
	subject: string
): Promise<PayslipReading> {
	try {
		const data = await readFile(join(env.UPLOAD_DIR || 'data', storedName));
		return await readPayslip(new Uint8Array(data), subject);
	} catch {
		return EMPTY;
	}
}
