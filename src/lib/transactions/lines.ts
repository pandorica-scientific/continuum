// SPDX-License-Identifier: AGPL-3.0-or-later
// The one place that knows a transaction may be split. Every consumer — cash
// flow, the briefing, the register, tag totals — resolves through here, so the
// branch exists once and is testable without a database.

export interface LineSource {
	amountMinor: bigint;
	feeMinor: bigint | null;
	categoryId: string | null;
}

export interface SplitSource {
	id?: string;
	amountMinor: bigint;
	categoryId: string | null;
	sort: number;
}

interface EffectiveLine {
	categoryId: string | null;
	amountMinor: bigint;
	/** null when the line is the transaction itself rather than a split row. */
	splitId: string | null;
}

/**
 * Resolve a transaction into the lines that count, net of the bank's own fee.
 *
 * Splits sum to the gross amountMinor, so the fee comes off the first line by sort
 * order: the lines then sum to exactly `amountMinor - fee` with no rounding drift,
 * matching what an unsplit transaction has always contributed.
 */
export function effectiveLines(txn: LineSource, splits: SplitSource[]): EffectiveLine[] {
	// A fee is always a cost: it makes money out more negative and money in less
	// positive, which is what subtraction does either way. This is the same
	// arithmetic cashflow.ts has always applied as `amountMinor - feeMinor`.
	const fee = txn.feeMinor ?? 0n;

	if (splits.length === 0) {
		return [{ categoryId: txn.categoryId, amountMinor: txn.amountMinor - fee, splitId: null }];
	}

	const ordered = [...splits].sort((a, b) => a.sort - b.sort);
	return ordered.map((split, index) => ({
		categoryId: split.categoryId,
		amountMinor: index === 0 ? split.amountMinor - fee : split.amountMinor,
		splitId: split.id ?? null
	}));
}

/**
 * How much of a transaction a category filter actually selects. Filtering by
 * groceries on a half-groceries receipt must show the groceries half, not the
 * whole receipt.
 */
export function matchingLineTotal(
	txn: LineSource,
	splits: SplitSource[],
	categoryId: string | null
): bigint {
	const lines = effectiveLines(txn, splits);
	const wanted = categoryId === null ? lines : lines.filter((l) => l.categoryId === categoryId);
	return wanted.reduce((sum, line) => sum + line.amountMinor, 0n);
}
