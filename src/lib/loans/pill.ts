// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What a loan's fixation says about itself, in the six words a pill holds.
 * Shared between the Loans screen and the Overview's Debts panel so both say
 * the same thing about the same loan.
 *
 * Pure, and told what day it is rather than reading the clock, so the wording
 * is testable on any day.
 */
import { periodForMonth, type FixationPeriod } from './amortise';
import type { Hue } from '$lib/ui/hue';

/**
 * How far ahead a fixation ending stops being a fact and becomes a decision.
 *
 * A year, because re-fixing is something a household shops around for over
 * months — not something it does in the week the bank's letter arrives.
 */
const REFIX_SOON_MONTHS = 12;

export interface FixationPill {
	label: string;
	hue: Hue;
}

export function fixationPill(
	regime: string,
	periods: FixationPeriod[],
	paidOff: boolean,
	today: string
): FixationPill {
	// Nothing else is worth saying about a loan that is gone, whatever its
	// fixation once was.
	if (paidOff) return { label: 'paid off', hue: 'grey' };
	if (regime === 'floating') return { label: 'floating rate', hue: 'yellow' };
	if (regime === 'fixed_term') return { label: 'fixed for the whole term', hue: 'teal' };

	const current = periodForMonth(periods, today.slice(0, 7));
	if (current?.endsOn) {
		// Read in UTC. The date is a plain `YYYY-MM-DD`; parsing it as an instant
		// and printing it in a timezone behind UTC lands on the last day of the
		// month before, which named the wrong month for half the world.
		const end = new Date(`${current.endsOn}T00:00:00Z`);
		const label = `fixed to ${end.toLocaleString('en', { month: 'short', timeZone: 'UTC' })} ${end.getUTCFullYear()}`;
		const monthsLeft =
			(end.getUTCFullYear() - Number(today.slice(0, 4))) * 12 +
			(end.getUTCMonth() + 1 - Number(today.slice(5, 7)));
		return { label, hue: monthsLeft <= REFIX_SOON_MONTHS ? 'yellow' : 'green' };
	}
	return { label: 'no fixation on record', hue: 'grey' };
}
