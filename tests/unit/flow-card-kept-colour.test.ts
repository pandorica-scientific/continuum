// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { signTone } from '$lib/charts/tone';

// "Kept" is the only signed figure in the totals row. It was painted green
// unconditionally, so a month that spent more than it earned reported its
// shortfall in the colour of a gain.
describe('signTone', () => {
	it('is green for a surplus', () => {
		expect(signTone(1)).toBe('--green');
		expect(signTone(120_000)).toBe('--green');
	});

	it('is green for exactly nothing kept, which is not a loss', () => {
		expect(signTone(0)).toBe('--green');
	});

	it('is red for a shortfall', () => {
		expect(signTone(-1)).toBe('--red');
		expect(signTone(-42_000)).toBe('--red');
	});
});
