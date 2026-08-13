// Day-count conventions a loan can accrue interest under. Shared between the
// server amortisation engine and the loan form.

export const DAY_COUNTS = ['30/360', 'act/365', 'act/360'] as const;
export type DayCount = (typeof DAY_COUNTS)[number];

export const DAY_COUNT_LABELS: Record<DayCount, string> = {
	'30/360': '30/360 — rate ÷ 12, every month equal',
	'act/365': 'actual/365 — real days between payments',
	'act/360': 'actual/360 — real days over a 360-day year'
};
