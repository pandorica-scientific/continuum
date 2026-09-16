// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import type { ParsedRow } from './types';

/**
 * Bump when any change to a parser or to fingerprint() would alter the
 * fingerprints of already-imported rows; stored per transaction so history
 * can be re-fingerprinted from the stored statement files.
 * v2: Revolut amounts became gross of fee (fee moved to its own column).
 * v3: minorDigits stopped assuming two minor units for every currency,
 *     changing amountMinor (and the hash) for HUF, JPY, KRW, ISK, IDR, VND,
 *     CLP, COP, KWD, BHD, OMR, JOD and TND.
 */
export const FINGERPRINT_VERSION = 3;

/**
 * Stable identity of a transaction across overlapping statement uploads.
 * Prefers the bank's own reference; otherwise uses the row's economic facts
 * plus the running balance (tells identical same-day payments apart in
 * formats that provide it). `occurrence` indexes a group of rows that are
 * identical even so, in statement order.
 *
 * The occurrence index applies to referenced rows too: `bankRef` is not
 * guaranteed unique (a split card authorisation, a shared instruction number)
 * and without the index such rows would hash identically and the unique
 * index on (accountId, dedupFingerprint) would silently discard the second.
 *
 * Occurrence 0 with a reference stays blank rather than "0", so no existing
 * fingerprint changes and FINGERPRINT_VERSION does not need a bump for this.
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
