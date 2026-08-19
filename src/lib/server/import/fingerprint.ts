// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { createHash } from 'node:crypto';
import type { ParsedRow } from './types';

/**
 * Bump when any change to a parser or to fingerprint() would alter the
 * fingerprints of already-imported rows; stored per transaction so history
 * can be re-fingerprinted from the stored statement files.
 * v2: Revolut amounts became gross of fee (fee moved to its own column).
 * v3: minorDigits stopped assuming two minor units for every currency, so
 *     parseAmountToMinor yields a different amountMinor — and therefore a
 *     different hash — for HUF, JPY, KRW, ISK, IDR, VND, CLP, COP, KWD, BHD,
 *     OMR, JOD and TND. Migration 0023 rescales the stored rows to match;
 *     without the bump, an overlapping statement in one of those currencies
 *     would hash differently from the row already in the ledger and import a
 *     second copy of every movement, with nothing reported as a duplicate.
 */
export const FINGERPRINT_VERSION = 3;

/**
 * Stable identity of a transaction across overlapping statement uploads.
 * Prefers the bank's own reference; otherwise uses the row's economic facts
 * plus the running balance (which tells identical same-day payments apart in
 * formats that provide it). `occurrence` is the index within a group of rows
 * that are identical even so — deterministic as long as the bank lists a
 * day's identical movements in a stable order, which statements do.
 *
 * The occurrence index applies to referenced rows too. `bankRef` is documented
 * as unique per movement, but that is the bank's promise, not an invariant we
 * can enforce: a split card authorisation, one instruction number printed on
 * both legs of an order, or a future adapter whose reference turns out to be a
 * batch id all repeat it. Without the index those rows hash identically and
 * the unique index on (accountId, dedupFingerprint) discards the second —
 * money leaves the ledger behind a clean "duplicate skipped", which is the one
 * failure this module exists to prevent. Re-uploading the same file still
 * dedups, because the indices are assigned in statement order.
 *
 * Occurrence 0 with a reference stays blank rather than "0", so no fingerprint
 * that can already be in a database changes and FINGERPRINT_VERSION does not
 * need a bump; only the case that used to be silently dropped gets a value.
 */
export function fingerprint(row: ParsedRow, occurrence: number): string {
	const parts = [
		row.bookedAt,
		row.amountMinor.toString(),
		row.currency,
		row.bankRef ?? '',
		row.bankRef ? '' : (row.counterpartyAccount ?? ''),
		row.bankRef ? '' : (row.counterparty ?? ''),
		row.bankRef ? '' : (row.balanceAfterMinor?.toString() ?? ''),
		row.bankRef && occurrence === 0 ? '' : String(occurrence)
	];
	return createHash('sha256').update(parts.join('\0')).digest('hex');
}

/** Assign occurrence indices to rows that would otherwise collide. */
export function fingerprintAll(rows: ParsedRow[]): string[] {
	const seen = new Map<string, number>();
	return rows.map((row) => {
		const base = fingerprint(row, 0);
		const occurrence = seen.get(base) ?? 0;
		seen.set(base, occurrence + 1);
		return occurrence === 0 ? base : fingerprint(row, occurrence);
	});
}
