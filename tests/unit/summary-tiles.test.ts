// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { taxSummaryTiles } from '$lib/tax-tiles';
import { salarySummaryTiles } from '$lib/salary-tiles';

/**
 * The two screens that used to own a way of drawing figures.
 *
 * The bands rendered NOTHING with no years, so the page jumped the moment the
 * first year arrived. As tiles they always draw, reading `—` — which is also
 * what makes the frame the same height on every screen.
 */
describe('summary tiles', () => {
	it('tax: an empty record draws dashes, never blanks', () => {
		const tiles = taxSummaryTiles([], 'CZK');
		expect(tiles.length).toBeGreaterThanOrEqual(3);
		for (const tile of tiles) {
			expect(tile.label.length).toBeGreaterThan(0);
			expect(tile.value).toBe('—');
		}
	});

	it('salary: an empty record draws dashes, never blanks', () => {
		const tiles = salarySummaryTiles([], 'CZK', 'household');
		expect(tiles.length).toBeGreaterThanOrEqual(3);
		for (const tile of tiles) expect(tile.value).toBe('—');
	});

	it('a figure that is nothing takes no colour', () => {
		// A red dash reads as a bad number at a glance; a green one as a good.
		for (const tile of taxSummaryTiles([], 'CZK')) expect(tile.color).toBeUndefined();
		for (const tile of salarySummaryTiles([], 'CZK', 'person')) expect(tile.color).toBeUndefined();
	});

	it('salary: the household and one person are asked different questions', () => {
		const years = [
			{
				year: 2025,
				age: 40,
				grossAvgMinor: '10000',
				netAvgMinor: '8000',
				grossTotalMinor: '1200000',
				baseTotalMinor: '1100000',
				bonusTotalMinor: '100000',
				equityTotalMinor: '0',
				equityOnPayslipMinor: '0',
				netTotalMinor: '900000',
				grossMonths: 12,
				netMonths: 12,
				netComplete: true,
				deltaPct: null,
				baseDeltaPct: 5
			}
		];
		expect(salarySummaryTiles(years, 'CZK', 'household').map((t) => t.label)).toEqual([
			'Earned since 2025',
			'Average year',
			'Last year · 2025',
			'Equity vested · 2025'
		]);
		expect(salarySummaryTiles(years, 'CZK', 'person').map((t) => t.label)).toEqual([
			'Earned since 2025',
			'Average month',
			'Last increase',
			'Average month, 2025',
			'Equity vested · 2025'
		]);
	});

	it('salary: the equity tile says what vested and how much a payslip already carried', () => {
		const base = {
			year: 2026,
			age: null,
			grossAvgMinor: '100000',
			netAvgMinor: null,
			grossTotalMinor: '1200000',
			baseTotalMinor: '1200000',
			bonusTotalMinor: '0',
			netTotalMinor: '0',
			grossMonths: 12,
			netMonths: 0,
			netComplete: false,
			deltaPct: null,
			baseDeltaPct: null
		};
		const none = salarySummaryTiles(
			[{ ...base, equityTotalMinor: '0', equityOnPayslipMinor: '0' }],
			'CZK',
			'person'
		).at(-1)!;
		expect(none.value).toBe('—');
		expect(none.note).toBe('no grant vested');
		const some = salarySummaryTiles(
			[{ ...base, equityTotalMinor: '350000', equityOnPayslipMinor: '50000' }],
			'CZK',
			'person'
		).at(-1)!;
		expect(some.label).toBe('Equity vested · 2026');
		expect(some.value).toBe('3\u202f500');
		expect(some.note).toBe('500 of it on payslips');
	});

	it('the band components are gone and the screens use SummaryBand', () => {
		expect(() => readFileSync('src/lib/components/TaxSummaryBand.svelte')).toThrow();
		expect(() => readFileSync('src/lib/components/SalarySummaryBand.svelte')).toThrow();
		expect(readFileSync('src/routes/(app)/tax/+page.svelte', 'utf8')).toContain('<SummaryBand');
		expect(readFileSync('src/routes/(app)/salary/+page.svelte', 'utf8')).toContain('<SummaryBand');
	});
});
