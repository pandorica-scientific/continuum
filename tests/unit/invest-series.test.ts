// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { seriesFor } from '$lib/invest/series';

describe('holding colours', () => {
	it('gives each holding one colour, in list order, and repeats after the palette', () => {
		const color = seriesFor(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
		expect(color('A')).toBe('--teal');
		expect(color('B')).toBe('--blue');
		expect(color('H')).toBe('--teal');
	});
	it('answers the same for the pie and the table', () => {
		const color = seriesFor(['VWCE', 'CSPX']);
		expect(color('CSPX')).toBe(color('CSPX'));
		expect(color('nowhere')).toBe('--fg3');
	});
});
