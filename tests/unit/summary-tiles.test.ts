// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { taxSummaryTiles } from '$lib/tax-tiles';
import { salarySummaryTiles } from '$lib/salary-tiles';

// Tiles always draw, reading `—` with no data, so the page never jumps layout
// the moment the first year arrives.
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
				equityUnvestedMinor: '0',
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
			'Equity awarded · 2025',
			'Equity to vest'
		]);
		expect(salarySummaryTiles(years, 'CZK', 'person').map((t) => t.label)).toEqual([
			'Earned since 2025',
			'Average month',
			'Last increase',
			'Average month, 2025',
			'Equity awarded · 2025',
			'Equity to vest'
		]);
	});

	it('salary: what is still to vest is its own tile, at today’s close', () => {
		// Never added to the vested figure beside it: one is fixed at each vest
		// day and already earned, the other is a live quote on shares nobody has.
		const [tile] = salarySummaryTiles([], 'CZK', 'person', {
			heldMinor: '200000',
			heldUnits: 20,
			pendingMinor: '420000',
			pendingUnits: 42,
			unpricedUnits: 0
		}).filter((t) => t.label === 'Equity to vest');
		expect(tile.value).toBe('4\u0027200');
		expect(tile.note).toBe("42 units at today's close");
	});

	it('salary: units no feed prices are named, not quietly valued at nothing', () => {
		const [tile] = salarySummaryTiles([], 'CZK', 'person', {
			heldMinor: '0',
			heldUnits: 0,
			pendingMinor: '0',
			pendingUnits: 42,
			unpricedUnits: 42
		}).filter((t) => t.label === 'Equity to vest');
		// A zero here would read as "worth nothing", which is a different claim.
		expect(tile.value).toBe('—');
		expect(tile.note).toBe('42 units, no price for them yet');
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
			equityUnvestedMinor: '0',
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
		).find((t) => t.label.startsWith('Equity awarded'))!;
		expect(none.value).toBe('—');
		expect(none.note).toBe('no grant that year');
		const some = salarySummaryTiles(
			[{ ...base, equityTotalMinor: '350000', equityOnPayslipMinor: '50000' }],
			'CZK',
			'person'
		).find((t) => t.label.startsWith('Equity awarded'))!;
		expect(some.label).toBe('Equity awarded · 2026');
		expect(some.value).toBe('3\u0027500');
		expect(some.note).toBe('500 of it on payslips');
	});

	it('the band components are gone and the screens use SummaryBand', () => {
		expect(() => readFileSync('src/lib/components/TaxSummaryBand.svelte')).toThrow();
		expect(() => readFileSync('src/lib/components/SalarySummaryBand.svelte')).toThrow();
		expect(readFileSync('src/routes/(app)/tax/+page.svelte', 'utf8')).toContain('<SummaryBand');
		expect(readFileSync('src/routes/(app)/salary/+page.svelte', 'utf8')).toContain('<SummaryBand');
	});
});
