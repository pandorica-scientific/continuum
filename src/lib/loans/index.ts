// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Day-count conventions a loan can accrue interest under. Shared between the
// server amortisation engine and the loan form.

/** Derived, so the loan form and the CHECK on loan.day_count cannot disagree. */
import { ENUMS } from '$lib/enums';

export const DAY_COUNTS = ENUMS['loan.day_count'];
export type DayCount = (typeof DAY_COUNTS)[number];

export const DAY_COUNT_LABELS: Record<DayCount, string> = {
	'30/360': '30/360 — rate ÷ 12, every month equal',
	'act/365': 'actual/365 — real days between payments',
	'act/360': 'actual/360 — real days over a 360-day year'
};
