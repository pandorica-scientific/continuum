// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { maxGross, taxBarSegments, type SerialisedYear } from '$lib/charts/tax-chart-geometry';

/**
 * What a tax bar means. Where it goes is `line-chart.test.ts` now.
 *
 * The slot spacing, the bar width cap, the hairline floor under a tiny segment
 * and the "no stroke on a segment too thin to carry one" rule all moved into
 * the shared chart engine in v0.8.1, and are tested there once instead of
 * here and in the salary chart's own copy of the same arithmetic. What is
 * still this file's business is the ORDER of the blocks, because that order is
 * the picture the engine draws.
 */
const hues = new Map([
	['CZ', '--series-health-soft'],
	['PL', '--series-taxes-soft']
]);

/** A year whose PL filing is two orders below its CZ one — the real shape. */
const lopsided: SerialisedYear = {
	year: 2025,
	grossMinor: '10000000',
	taxMinor: '2000000',
	ratePct: 20,
	byCountry: [
		{ country: 'CZ', grossMinor: '9990000', taxMinor: '2000000', ratePct: 20 },
		{ country: 'PL', grossMinor: '10000', taxMinor: '0', ratePct: 0 }
	]
};

describe('the blocks a tax bar is made of', () => {
	it('puts every tax block at the foot and every kept block above it', () => {
		// The engine stacks in the order it is given, so this order IS the
		// picture: the hatched foot has to be one block rather than interleaved
		// with what was kept.
		const out = taxBarSegments(lopsided, hues);
		const lastHatched = out.map((s) => s.hatched).lastIndexOf(true);
		const firstKept = out.map((s) => s.hatched).indexOf(false);
		expect(lastHatched).toBeLessThan(firstKept);
	});

	it('draws what was kept, not what was earned, above the tax', () => {
		const [, kept] = taxBarSegments(lopsided, hues).filter((s) => !s.hatched);
		// CZ: 9 990 000 earned less 2 000 000 tax.
		const cz = taxBarSegments(lopsided, hues).find((s) => !s.hatched && s.country === 'CZ');
		expect(cz?.value).toBe(7_990_000);
		expect(kept ?? cz).toBeDefined();
	});

	it('keeps a filing two orders below the rest rather than dropping it', () => {
		const pl = taxBarSegments(lopsided, hues).filter((s) => s.country === 'PL');
		// PL paid no tax, so only its kept block survives — and it does survive.
		expect(pl).toHaveLength(1);
		expect(pl[0].value).toBe(10_000);
	});

	it('drops a block worth nothing, which the hairline floor would make visible', () => {
		const nothing: SerialisedYear = {
			...lopsided,
			byCountry: [{ country: 'CZ', grossMinor: '0', taxMinor: '0', ratePct: null }]
		};
		expect(taxBarSegments(nothing, hues)).toEqual([]);
	});

	it('falls back to a palette colour for a country nobody has a hue for', () => {
		const unknown: SerialisedYear = {
			...lopsided,
			byCountry: [{ country: 'ZZ', grossMinor: '100', taxMinor: '10', ratePct: 10 }]
		};
		expect(taxBarSegments(unknown, new Map())[0].stroke).toBe('var(--series-r1)');
	});
});

describe('maxGross', () => {
	it('finds the tallest year', () => {
		expect(
			maxGross([
				{ year: 2024, grossMinor: '500', taxMinor: '0', ratePct: null, byCountry: [] },
				{ year: 2025, grossMinor: '900', taxMinor: '0', ratePct: null, byCountry: [] }
			])
		).toBe(900n);
	});

	it('is zero for an empty record rather than undefined', () => {
		expect(maxGross([])).toBe(0n);
	});
});
