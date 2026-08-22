// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Server side of the salary tracker: pull the text out of an uploaded payslip
// PDF, detect the pay amount and period, and remember which label the user's
// corrections point at so the next slip for the same person reads itself.
//
// `./entries` is the other half: salary as it is RECORDED, from a payslip or
// from a salary credit the ledger already holds.
export * from './entries';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import { extractPdfLines } from '$lib/server/import/pdftext';
import { getSetting, setSetting } from '$lib/server/settings';
import { detectPeriod, extractCandidates, pickAmount, type AmountCandidate } from '$lib/salary';
import { getBaseCurrency } from '$lib/server/settings';

interface PayslipReading {
	amountMinor: bigint | null;
	periodMonth: string | null;
	candidates: AmountCandidate[];
}

async function learnedLabels(): Promise<Record<string, string>> {
	return getSetting<Record<string, string>>('payslipLabels', {});
}

/** Read a payslip PDF: candidates, best amount (learned label first), period. */
export async function readPayslip(data: Uint8Array, subject: string): Promise<PayslipReading> {
	let lines: string[];
	try {
		lines = (await extractPdfLines(data)).map((l) => l.cells.join(' '));
	} catch {
		return { amountMinor: null, periodMonth: null, candidates: [] };
	}
	const candidates = extractCandidates(lines, await getBaseCurrency());
	const labels = await learnedLabels();
	const picked = pickAmount(candidates, labels[subject.toLowerCase()] ?? null);
	return {
		amountMinor: picked?.amountMinor ?? null,
		periodMonth: detectPeriod(lines),
		candidates
	};
}

/**
 * The user stated the amount; if it matches a candidate on the slip, remember
 * that candidate's label for this person — the correction teaches the reader.
 */
export async function learnAmountLabel(
	subject: string,
	amountMinor: bigint,
	candidates: AmountCandidate[]
): Promise<void> {
	const hit = candidates.filter((c) => c.amountMinor === amountMinor).at(-1);
	if (!hit || !hit.label) return;
	const labels = await learnedLabels();
	labels[subject.toLowerCase()] = hit.label;
	await setSetting('payslipLabels', labels);
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
		return { amountMinor: null, periodMonth: null, candidates: [] };
	}
}
