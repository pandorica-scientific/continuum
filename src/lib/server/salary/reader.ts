// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Pull the text out of an uploaded payslip PDF, pick its gross, net and bonus,
// and remember which label each correction pointed at so the next slip for the
// same person reads itself.
//
// Its own module rather than sitting in `index.ts`: `backfill.ts` needs
// `readStoredPayslip`, and `index.ts` re-exports `backfill.ts`, so leaving it
// there would make the two files import each other.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { extractPdfLines } from '$lib/server/import/pdftext';
import { getBaseCurrency, getSetting, setSetting } from '$lib/server/settings';
import { availableCurrencies } from '$lib/server/fx/currencies';
import {
	bonusLabelSubset,
	detectBonus,
	detectCurrency,
	detectPeriod,
	extractCandidates,
	pickGross,
	pickNet,
	type AmountCandidate
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
	 * The currency the slip is printed in, or null when it does not say.
	 *
	 * Null is not "the base currency". It is the form's cue to ask, and the
	 * asking is the point: taking the household's base currency for the answer
	 * is what filed six Czech payslips as euro.
	 */
	currency: string | null;
	candidates: AmountCandidate[];
}

const EMPTY: PayslipReading = {
	grossMinor: null,
	netMinor: null,
	bonusMinor: null,
	periodMonth: null,
	currency: null,
	candidates: []
};

/**
 * Gross and net labels are learned under their OWN keys.
 *
 * One shared key was the v0.4.5 arrangement, and with the reader preferring net
 * wordings it meant a person's learned label was always a net one — while
 * everything downstream filed what it found as gross.
 */
async function learnedGrossLabels(): Promise<Record<string, string>> {
	return getSetting<Record<string, string>>('payslipGrossLabels', {});
}

/**
 * Net labels, seeded from the pre-v0.4.6 `payslipLabels`.
 *
 * That key's values are net wordings — `pickAmount` ranked by NET_PAY_KEYWORDS —
 * so carrying them over as net is the truthful reading of what was learned.
 * Read-through rather than a migration write: the next correction replaces the
 * entry under the new key anyway, and the current key wins where both exist.
 */
async function learnedNetLabels(): Promise<Record<string, string>> {
	const [current, legacy] = await Promise.all([
		getSetting<Record<string, string>>('payslipNetLabels', {}),
		getSetting<Record<string, string>>('payslipLabels', {})
	]);
	return { ...legacy, ...current };
}

/**
 * Bonus labels are learned under their own key, as a LIST.
 *
 * Sharing the pay key would let a bonus correction overwrite the pay label for
 * the same person — and the next slip would then file its bonus as the month's
 * pay. A list rather than one string because a month's bonus is routinely two
 * lines, and naming only one of them under-reads it next month.
 */
async function learnedBonusLabels(): Promise<Record<string, string[]>> {
	const stored = await getSetting<Record<string, string | string[]>>('payslipBonusLabels', {});
	// Values written before v0.4.6 are a bare string. Read, never rewritten:
	// the next correction replaces the entry with a list anyway.
	return Object.fromEntries(
		Object.entries(stored).map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
	);
}

/** Read a payslip PDF: gross, net, bonus, the month, and every candidate line. */
export async function readPayslip(data: Uint8Array, subject: string): Promise<PayslipReading> {
	let lines: string[];
	try {
		lines = (await extractPdfLines(data)).map((l) => l.cells.join(' '));
	} catch {
		return EMPTY;
	}
	// The currency comes first: `extractCandidates` scales printed amounts by the
	// currency's own minor units, so parsing before knowing which currency it is
	// would be reading the digits under the wrong rule.
	const currency = detectCurrency(lines, await availableCurrencies());
	// Only for parsing, and only when the slip did not say. The reading still
	// reports `currency: null` so the form asks rather than assuming.
	const candidates = extractCandidates(lines, currency ?? (await getBaseCurrency()));
	const [gross, net, bonus] = await Promise.all([
		learnedGrossLabels(),
		learnedNetLabels(),
		learnedBonusLabels()
	]);
	const key = subject.toLowerCase();
	return {
		grossMinor: pickGross(candidates, gross[key] ?? null)?.amountMinor ?? null,
		netMinor: pickNet(candidates, net[key] ?? null)?.amountMinor ?? null,
		bonusMinor: detectBonus(candidates, bonus[key] ?? null),
		periodMonth: detectPeriod(lines),
		currency,
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
	candidates: AmountCandidate[]
): Promise<void> {
	const hit = candidates.filter((c) => c.amountMinor === amountMinor).at(-1);
	if (!hit || !hit.label) return;
	const labels = await getSetting<Record<string, string>>(key, {});
	labels[subject.toLowerCase()] = hit.label;
	await setSetting(key, labels);
}

export async function learnGrossLabel(
	subject: string,
	grossMinor: bigint,
	candidates: AmountCandidate[]
): Promise<void> {
	await learnLabel('payslipGrossLabels', subject, grossMinor, candidates);
}

export async function learnNetLabel(
	subject: string,
	netMinor: bigint,
	candidates: AmountCandidate[]
): Promise<void> {
	await learnLabel('payslipNetLabels', subject, netMinor, candidates);
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
	candidates: AmountCandidate[]
): Promise<void> {
	const found = bonusLabelSubset(candidates, bonusMinor);
	if (!found || found.length === 0) return;
	const labels = await learnedBonusLabels();
	labels[subject.toLowerCase()] = found;
	await setSetting('payslipBonusLabels', labels);
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
