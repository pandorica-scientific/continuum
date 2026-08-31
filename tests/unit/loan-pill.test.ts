// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fixationPill } from '$lib/loans/pill';
import type { FixationPeriod } from '$lib/loans/amortise';

const period = (startsOn: string, endsOn: string | null): FixationPeriod => ({
	startsOn,
	endsOn,
	annualRatePct: 4.44,
	paymentMinor: 5_445_600n
});

const TODAY = '2026-08-29';
/** A superseded period and the one in force, so "current" is not just the only row. */
const fixed = [period('2020-01-01', '2023-01-01'), period('2023-01-01', '2029-03-01')];

describe('fixationPill', () => {
	// Nothing else is worth saying about a loan that is gone, whatever its
	// fixation once was — so this answer comes before every other question.
	it('says paid off before it says anything else', () => {
		expect(fixationPill('fixed_period', fixed, true, TODAY)).toEqual({
			label: 'paid off',
			hue: 'grey'
		});
	});

	it('names the regime where the regime is the whole story', () => {
		expect(fixationPill('floating', [], false, TODAY)).toEqual({
			label: 'floating rate',
			hue: 'yellow'
		});
		expect(fixationPill('fixed_term', [], false, TODAY)).toEqual({
			label: 'fixed for the whole term',
			hue: 'teal'
		});
	});

	// Green is "settled", amber is "a decision is coming". A year is the line:
	// re-fixing is something a household shops around for, not something it does
	// in the week the letter arrives.
	it('turns amber a year before the fixation ends', () => {
		expect(fixationPill('fixed_period', fixed, false, TODAY)).toEqual({
			label: 'fixed to Mar 2029',
			hue: 'green'
		});
		expect(fixationPill('fixed_period', fixed, false, '2028-05-29')).toEqual({
			label: 'fixed to Mar 2029',
			hue: 'yellow'
		});
	});

	// Read in UTC, so the month on the pill is the month on the paper wherever
	// the server happens to be: parsing the date as an instant and printing it
	// in a timezone behind UTC named the month before for half the world.
	it('names the month the fixation actually ends in', () => {
		expect(
			fixationPill('fixed_period', [period('2023-01-01', '2027-01-01')], false, TODAY).label
		).toBe('fixed to Jan 2027');
	});

	it('says so where there is no fixation to report', () => {
		expect(fixationPill('fixed_period', [], false, TODAY)).toEqual({
			label: 'no fixation on record',
			hue: 'grey'
		});
		// An open-ended period has a rate but no end to count down to.
		expect(fixationPill('fixed_period', [period('2023-01-01', null)], false, TODAY)).toEqual({
			label: 'no fixation on record',
			hue: 'grey'
		});
	});
});
