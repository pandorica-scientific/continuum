// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Two years. Below this the axis labels months, at or above it years — a
 * per-month axis of 24+ labels stops being readable at this chart's width.
 */
const YEARLY_TICKS_FROM_MONTHS = 24;

/** Axis labels for a run of `YYYY-MM` months in ascending order. */
export function historyTicks(months: string[]): { unit: 'month' | 'year'; labels: string[] } {
	if (months.length >= YEARLY_TICKS_FROM_MONTHS) {
		return { unit: 'year', labels: [...new Set(months.map((m) => m.slice(0, 4)))] };
	}
	return { unit: 'month', labels: months.map((m) => m.slice(5, 7)) };
}
