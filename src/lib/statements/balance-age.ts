// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * How old the balance an account screen is showing actually is.
 *
 * Deliberately NOT the same question as `statementStatus` next door. That one
 * asks when the household last UPLOADED, which is how you tell somebody they
 * are behind on filing. This one asks what date the figure on screen is true
 * for, which is how you stop a correct number being read as a wrong one.
 *
 * The two come apart exactly when it matters most: uploading six months of
 * statements this afternoon makes an account perfectly up to date by upload
 * day, while the newest balance in the pile is still the end of last month.
 *
 * Pure, and its own file, because the rule is one sentence and the screens
 * that ask it should not each answer it differently.
 */
import { daysBetween } from '$lib/dates';

/**
 * Days before a balance is worth marking as old.
 *
 * A statement covers a period and lands after that period ends, so a figure is
 * always a few days behind and saying so every time would be noise. A week is
 * long enough to cover the ordinary lag on a monthly statement, and short
 * enough that last month's closing balance is called what it is.
 */
const BALANCE_FRESH_DAYS = 7;

export interface BalanceAge {
	/** Days between the date the balance is true for and today. */
	days: number;
	/** True once it is worth saying out loud. */
	stale: boolean;
}

/**
 * `balanceOn` is the day the figure is true for — a statement's period end.
 *
 * Null for an account that has never had a statement: nothing is being shown,
 * so nothing is old. A date in the future is not negative-aged either; it is
 * simply current.
 */
export function balanceAge(balanceOn: string | null, today: string): BalanceAge | null {
	if (!balanceOn) return null;
	const days = daysBetween(balanceOn, today);
	if (days <= 0) return { days: 0, stale: false };
	return { days, stale: days > BALANCE_FRESH_DAYS };
}

/** "17 days old", or "yesterday" — the phrase the screen prints beside the figure. */
export function balanceAgeLabel(age: BalanceAge): string {
	if (age.days === 1) return 'yesterday';
	return `${age.days} days old`;
}
