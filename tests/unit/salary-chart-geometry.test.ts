// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	barValues,
	ceilingFor,
	salaryBarSegments,
	type SerialisedSalaryYear
} from '$lib/charts/salary-chart-geometry';

/**
 * Tests only what a salary bar's segments mean; drawing geometry (stacking,
 * hairline floor, change scale, hover) lives in line-chart.test.ts.
 */
const year = (over: Partial<Record<string, unknown>> = {}) =>
	({
		year: 2025,
		grossAvgMinor: '7000000',
		netAvgMinor: '5000000',
		grossTotalMinor: '84000000',
		baseTotalMinor: '78000000',
		bonusTotalMinor: '6000000',
		equityTotalMinor: '0',
		equityOnPayslipMinor: '0',
		netTotalMinor: '60000000',
		grossMonths: 12,
		netMonths: 12,
		netComplete: true,
		deltaPct: 5,
		baseDeltaPct: 2,
		...over
	}) as SerialisedSalaryYear;

describe('barValues', () => {
	it('uses the year totals in total mode', () => {
		const v = barValues(year(), 'total');
		expect(v.base).toBe(78000000n);
		expect(v.bonus).toBe(6000000n);
	});

	it('divides by the months actually recorded in average mode', () => {
		// A partial year is compared as a monthly rate, not as a short year.
		const v = barValues(
			year({ grossMonths: 4, baseTotalMinor: '28000000', bonusTotalMinor: '0' }),
			'avg'
		);
		expect(v.base).toBe(7000000n);
	});

	it('does not divide by zero when a year has no gross months', () => {
		const v = barValues(year({ grossMonths: 0 }), 'avg');
		expect(v.base).toBe(78000000n);
	});

	it('reports no net for a year the ledger never saw', () => {
		expect(barValues(year({ netMonths: 0 }), 'total').net).toBeNull();
		expect(barValues(year({ netAvgMinor: null }), 'avg').net).toBeNull();
	});
});
describe('ceilingFor', () => {
	it('scales every year against the tallest', () => {
		const rows = [year({ year: 2024, baseTotalMinor: '40000000', bonusTotalMinor: '0' }), year()];
		expect(ceilingFor(rows, 'total')).toBe(84000000n);
	});

	it('has its own ceiling per mode', () => {
		const rows = [year()];
		expect(ceilingFor(rows, 'avg')).toBeLessThan(ceilingFor(rows, 'total'));
	});
});

describe('the blocks a salary bar is made of', () => {
	it('seats the bonus on the baseline with the base above it', () => {
		// Bonus below base so a changing bonus never moves the base's boundary.
		const out = salaryBarSegments(year(), 'total');
		expect(out.map((s) => s.kind)).toEqual(['bonus', 'base']);
	});

	it('draws no bonus block for a year that had none', () => {
		const out = salaryBarSegments(year({ bonusTotalMinor: '0' }), 'total');
		expect(out.map((s) => s.kind)).toEqual(['base']);
	});

	it('never makes net a block — it crosses the bar instead', () => {
		const out = salaryBarSegments(year(), 'total');
		expect(out.some((s) => (s.kind as string) === 'net')).toBe(false);
		// Gross IS the whole bar: base plus bonus and nothing else.
		expect(out.reduce((sum, s) => sum + s.value, 0)).toBe(84_000_000);
	});

	it('measures against the mode, so an average year is a monthly bar', () => {
		const out = salaryBarSegments(year(), 'avg');
		expect(out.reduce((sum, s) => sum + s.value, 0)).toBe(7_000_000);
	});
});

describe('equity on the bar', () => {
	it('draws only the vests a payslip did not already carry, and counts them in the ceiling', () => {
		const row = year({ equityTotalMinor: '9000000', equityOnPayslipMinor: '3000000' });
		const segments = salaryBarSegments(row, 'total');
		expect(segments[0]).toMatchObject({ kind: 'equity', value: 6_000_000 });
		expect(ceilingFor([row], 'total')).toBe(
			BigInt(row.baseTotalMinor) + BigInt(row.bonusTotalMinor) + 6_000_000n
		);
		expect(salaryBarSegments(year(), 'total').some((s) => s.kind === 'equity')).toBe(false);
	});
});
