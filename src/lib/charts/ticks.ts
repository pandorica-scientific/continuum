// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Two years. Below this the axis labels months, at or above it years.
 *
 * A presentation judgement rather than a derived fact, so it is named and
 * explained rather than inlined. At two years a per-month axis is 24 labels,
 * which is where they stop being readable at the width this chart is given.
 * Below it the old behaviour showed one year label under every bar, so a
 * household three months into importing was told nothing at all by the axis.
 */
const YEARLY_TICKS_FROM_MONTHS = 24;

/** Axis labels for a run of `YYYY-MM` months in ascending order. */
export function historyTicks(months: string[]): { unit: 'month' | 'year'; labels: string[] } {
	if (months.length >= YEARLY_TICKS_FROM_MONTHS) {
		return { unit: 'year', labels: [...new Set(months.map((m) => m.slice(0, 4)))] };
	}
	return { unit: 'month', labels: months.map((m) => m.slice(5, 7)) };
}
