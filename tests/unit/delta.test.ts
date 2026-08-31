// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { deltaPct, deltaTone } from '$lib/charts/delta';

describe('deltaPct', () => {
	it('reports the change as a whole percent of the window before', () => {
		expect(deltaPct(112, 100)).toBe(12);
		expect(deltaPct(92, 100)).toBe(-8);
		expect(deltaPct(100, 100)).toBe(0);
		// Rounded, not truncated: a strip of figures printed to one decimal is
		// precision the comparison does not have. And rounded about zero, so the
		// same movement is the same number whichever way it went.
		expect(deltaPct(1015, 1000)).toBe(2);
		expect(deltaPct(985, 1000)).toBe(-2);
	});

	// "Up from nothing" is not a percentage, and a household that saved nothing
	// last month would otherwise be told it saved infinitely more this one.
	it('has nothing to compare against a window that came to nothing', () => {
		expect(deltaPct(4_000, 0)).toBeNull();
		expect(deltaPct(4_000, -2_000)).toBeNull();
	});
});

describe('deltaTone', () => {
	// Green is not "bigger" — it is "better". Spending more is the same arrow as
	// earning more and the opposite piece of news.
	it('greens a rise where rising is good, and a fall where falling is', () => {
		expect(deltaTone(12, true)).toBe('--green');
		expect(deltaTone(-8, false)).toBe('--green');
	});

	it('reds the other two', () => {
		expect(deltaTone(-8, true)).toBe('--red');
		expect(deltaTone(12, false)).toBe('--red');
	});

	// No change and no comparison are both "nothing to say", and saying it in a
	// state colour would report a rounding artefact as news.
	it('stays quiet when nothing moved and when there is nothing to compare', () => {
		expect(deltaTone(0, true)).toBe('--fg3');
		expect(deltaTone(0, false)).toBe('--fg3');
		expect(deltaTone(null, true)).toBe('--fg3');
		expect(deltaTone(null, false)).toBe('--fg3');
	});
});
