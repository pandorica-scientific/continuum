// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The bottle silhouette, and where its label sits.
 *
 * These exist because of a bug that reached a phone: the label photograph was
 * handed to the drawing library, which put it in as `<image href="/files/…">`,
 * which `assertInertSvg` refuses — so every bottle with a photograph threw, the
 * error was caught, and the card drew nothing at all. The drawing is inert and
 * the photograph goes over the top.
 */
import { describe, expect, it } from 'vitest';
import { BOTTLE_ASPECT, assertInertSvg, bottleLabelBox, bottleSvg } from '$lib/life/art';
import { ENUMS } from '$lib/enums';

const subject = {
	id: '01a09002-32ba-70d0-86e0-5dda355fea04',
	type: 'whisky' as const,
	producer: 'Lagavulin',
	name: '16 Year Old'
};

describe('the silhouette', () => {
	// The whole point: whatever the library is asked for, what comes back must
	// survive the check that runs before it reaches `{@html}`.
	it('is inert for every kind of bottle', () => {
		for (const type of ENUMS['bottle.type']) {
			const svg = bottleSvg({ ...subject, type });
			expect(() => assertInertSvg(svg)).not.toThrow();
		}
	});

	it('carries no image element and no outward reference', () => {
		const svg = bottleSvg(subject);
		expect(svg).not.toMatch(/<\s*image/i);
		expect(svg).not.toMatch(/href\s*=\s*["'](?!#)/i);
	});

	// A grid of twenty bottles on one page would otherwise have twenty gradients
	// all called the same thing, and the last one wins for all of them.
	it('names its own defs after the row', () => {
		const mine = bottleSvg(subject);
		const other = bottleSvg({ ...subject, id: '01a09002-3270-77a1-8e2a-346cc904010a' });
		expect(mine).not.toBe(other);
	});
});

describe('where the label sits', () => {
	it('is given as percentages, inside the drawing', () => {
		for (const type of ENUMS['bottle.type']) {
			const box = bottleLabelBox(type);
			for (const side of [box.left, box.top, box.width, box.height]) {
				expect(side).toMatch(/^[\d.]+%$/);
				expect(Number.parseFloat(side)).toBeGreaterThanOrEqual(0);
				expect(Number.parseFloat(side)).toBeLessThanOrEqual(100);
			}
			// A plate that starts inside and runs off the end is not on the bottle.
			expect(Number.parseFloat(box.left) + Number.parseFloat(box.width)).toBeLessThanOrEqual(100);
			expect(Number.parseFloat(box.top) + Number.parseFloat(box.height)).toBeLessThanOrEqual(100);
		}
	});

	// An unknown type falls back to a silhouette rather than throwing, because
	// the overlay is positioned before anything knows whether the art drew.
	it('has a box for every kind the enum allows', () => {
		for (const type of ENUMS['bottle.type']) {
			expect(() => bottleLabelBox(type)).not.toThrow();
		}
	});

	it('states the aspect the overlay is measured against', () => {
		expect(BOTTLE_ASPECT).toBe('400 / 160');
	});
});
