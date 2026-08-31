// SPDX-License-Identifier: AGPL-3.0-or-later
// How far a rule can be trusted, as the Wilson score lower bound on its
// accepted/corrected record.
//
// A plain ratio calls a rule that was right once 100% reliable, which is exactly
// when it should not be trusted. Wilson is conservative while evidence is thin
// and relaxes as it accumulates — the right shape for a household that sees a
// given merchant a handful of times a year.

/** 95% one-sided confidence level. A constant of the arithmetic, not a setting. */
const Z = 1.96;

export function confidence(accepted: number, corrected: number): number {
	const n = accepted + corrected;
	if (n === 0) return 0;
	const p = accepted / n;
	const z2 = Z * Z;
	const numerator = p + z2 / (2 * n) - Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
	const lower = numerator / (1 + z2 / n);
	return Math.max(0, Math.min(1, lower));
}
