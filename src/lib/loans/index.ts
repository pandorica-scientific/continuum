// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Day-count conventions a loan can accrue interest under. Shared between the
// server amortisation engine and the loan form.

/** Derived, so the loan form and the CHECK on loan.day_count cannot disagree. */
import { ENUMS, type EnumValue } from '$lib/enums';

export const DAY_COUNTS = ENUMS['loan.day_count'];
export type DayCount = (typeof DAY_COUNTS)[number];

export const DAY_COUNT_LABELS: Record<DayCount, string> = {
	'30/360': '30/360 — rate ÷ 12, every month equal',
	'act/365': 'actual/365 — real days between payments',
	'act/360': 'actual/360 — real days over a 360-day year'
};

/**
 * The event kinds that carry money out of an account towards a loan.
 *
 * Named once because the set is asked about from both ends and the two answers
 * have to be the same one: the cash-flow chart splits exactly these into
 * interest and principal, and recording a payment refuses a transaction that
 * one of them already claims. Two copies would let a transaction be claimed
 * twice by a kind only one of them counted.
 */
export const PAYMENT_KINDS: EnumValue<'loan_event.kind'>[] = ['payment', 'extra_payment'];
