// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { tagHue } from '$lib/tag-hue';

describe('tagHue', () => {
	it('gives a tag the same colour every time, everywhere', () => {
		expect(tagHue('renovation')).toBe(tagHue('renovation'));
	});

	it('folds case and spacing the way the server does', () => {
		// The server treats these as one tag; two colours for one tag would look
		// like two tags.
		expect(tagHue('Renovation')).toBe(tagHue('renovation'));
		expect(tagHue('  car   insurance ')).toBe(tagHue('car insurance'));
	});

	it('only ever answers from the reserve series', () => {
		// Never the traffic light: green, amber and red mean state here.
		for (const name of ['a', 'bill', 'insurance', 'holiday 2026', 'Ř', 'x'.repeat(40)]) {
			expect(tagHue(name)).toMatch(/^--series-r([1-9]|10)$/);
		}
	});

	it('spreads different tags over more than one colour', () => {
		const hues = new Set(
			['bill', 'insurance', 'holiday', 'car', 'school', 'warranty', 'renovation', 'tax'].map(tagHue)
		);
		expect(hues.size).toBeGreaterThan(3);
	});
});
