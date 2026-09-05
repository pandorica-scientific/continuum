// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fixationBand } from '$lib/loans/fixation-band';
import type { FixationPeriod } from '$lib/loans/amortise';

const period = (startsOn: string, endsOn: string | null, rate: number): FixationPeriod => ({
	startsOn,
	endsOn,
	annualRatePct: rate,
	paymentMinor: 0n
});

describe('the fixation band', () => {
	// The real shape: fixed twice, running to 2049, agreed only to 2028.
	const periods = [
		period('2024-01-01', '2026-01-01', 4.1),
		period('2026-01-01', '2028-08-01', 4.44)
	];

	it('draws nothing without an end date — there is no whole to take shares of', () => {
		expect(fixationBand(periods, null, '2026-09-01')).toEqual([]);
	});

	it('draws nothing for a loan with no periods', () => {
		expect(fixationBand([], '2049-01-01', '2026-09-01')).toEqual([]);
	});

	it('adds the unfixed remainder, which is the point of the picture', () => {
		const band = fixationBand(periods, '2049-01-01', '2026-09-01');
		expect(band.at(-1)?.kind).toBe('unknown');
		expect(band.at(-1)?.label).toContain('2028-08');
	});

	it('marks the period containing today as current, and the rest as past', () => {
		const band = fixationBand(periods, '2049-01-01', '2026-09-01');
		expect(band.map((s) => s.kind)).toEqual(['past', 'current', 'unknown']);
	});

	it('has no current segment when today is past every agreed rate', () => {
		const band = fixationBand(periods, '2049-01-01', '2030-01-01');
		expect(band.some((s) => s.kind === 'current')).toBe(false);
	});

	it('sums to the whole term', () => {
		const band = fixationBand(periods, '2049-01-01', '2026-09-01');
		const total = band.reduce((sum, s) => sum + s.widthPct, 0);
		expect(total).toBeCloseTo(100, 6);
	});

	it('gives the unfixed years the share they actually are', () => {
		// 2024→2049 is 25 years; 2028-08 onwards is a little over twenty of them.
		const band = fixationBand(periods, '2049-01-01', '2026-09-01');
		expect(band.at(-1)!.widthPct).toBeGreaterThan(75);
	});

	it('runs an open-ended period up to the next one', () => {
		const band = fixationBand(
			[period('2024-01-01', null, 4.1), period('2026-01-01', '2028-01-01', 5)],
			'2030-01-01',
			'2025-01-01'
		);
		expect(band[0].kind).toBe('current');
		expect(band).toHaveLength(3);
	});

	it('drops a period that ends before it starts rather than drawing it backwards', () => {
		const band = fixationBand([period('2026-01-01', '2024-01-01', 4)], '2030-01-01', '2026-06-01');
		expect(band.every((s) => s.widthPct > 0)).toBe(true);
	});

	it('orders periods by their start, whatever order they arrive in', () => {
		const band = fixationBand([periods[1], periods[0]], '2049-01-01', '2026-09-01');
		expect(band[0].label).toBe('4.1%');
	});
});
