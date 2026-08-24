// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import {
	MONEY_BOTTOM,
	MONEY_TOP,
	barValues,
	bars,
	ceilingFor,
	changeRuns,
	changeSpan,
	changeY,
	netTickY
} from '$lib/charts/salary-chart-geometry';

const year = (over: Partial<Record<string, unknown>> = {}) =>
	({
		year: 2025,
		grossAvgMinor: '7000000',
		netAvgMinor: '5000000',
		grossTotalMinor: '84000000',
		baseTotalMinor: '78000000',
		bonusTotalMinor: '6000000',
		netTotalMinor: '60000000',
		grossMonths: 12,
		netMonths: 12,
		netComplete: true,
		deltaPct: 5,
		baseDeltaPct: 2,
		...over
	}) as Parameters<typeof bars>[0];

describe('barValues', () => {
	it('uses the year totals in total mode', () => {
		const v = barValues(year(), 'total');
		expect(v.base).toBe(78000000n);
		expect(v.bonus).toBe(6000000n);
	});

	it('divides by the months actually recorded in average mode', () => {
		// A year with four payslips is compared as a monthly rate, not as a short
		// year — that comparison is the whole reason the mode exists.
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

describe('bars', () => {
	it('puts the bonus on top of the base, not beneath it', () => {
		// A bonus is what was added to a salary; drawing it at the foot makes the
		// base look like the thing sitting on top of it.
		const out = bars(year(), 'total', 84000000n);
		const base = out.find((s) => s.kind === 'base')!;
		const bonus = out.find((s) => s.kind === 'bonus')!;
		// SVG y grows downward, so "on top" means a smaller y.
		expect(bonus.y).toBeLessThan(base.y);
	});

	it('fills the panel for the tallest year', () => {
		const total = bars(year(), 'total', 84000000n).reduce((sum, s) => sum + s.height, 0);
		expect(total).toBeCloseTo(MONEY_BOTTOM - MONEY_TOP, 5);
	});

	it('starts at the baseline', () => {
		const out = bars(year(), 'total', 84000000n);
		expect(Math.max(...out.map((s) => s.y + s.height))).toBeCloseTo(MONEY_BOTTOM, 5);
	});

	it('omits a segment with nothing in it rather than drawing a hairline', () => {
		// A year with no bonus has no bonus segment at all. The hairline floor is
		// for a real figure too small to see, not for the absence of one.
		const out = bars(
			year({ bonusTotalMinor: '0', baseTotalMinor: '84000000' }),
			'total',
			84000000n
		);
		expect(out.map((s) => s.kind)).toEqual(['base']);
	});

	it('keeps a tiny bonus visible', () => {
		const out = bars(
			year({ bonusTotalMinor: '1000', baseTotalMinor: '83999000' }),
			'total',
			84000000n
		);
		const bonus = out.find((s) => s.kind === 'bonus')!;
		expect(bonus.height).toBeGreaterThanOrEqual(0.8);
		expect(bonus.stroked).toBe(false);
	});

	it('strokes a segment big enough to carry one', () => {
		const out = bars(year(), 'total', 84000000n);
		for (const s of out) expect(s.stroked).toBe(true);
	});

	it('draws nothing rather than dividing by zero on an empty record', () => {
		expect(bars(year(), 'total', 0n)).toEqual([]);
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

describe('netTickY', () => {
	it('sits below the top of the bar, because net is less than gross', () => {
		const tick = netTickY(year(), 'total', 84000000n)!;
		const top = Math.min(...bars(year(), 'total', 84000000n).map((s) => s.y));
		expect(tick).toBeGreaterThan(top);
	});

	it('is null for a year with no net at all', () => {
		expect(netTickY(year({ netMonths: 0 }), 'total', 84000000n)).toBeNull();
	});
});

describe('the change scale', () => {
	it('is symmetric, so a pay cut is not drawn as no change', () => {
		const span = 10;
		const band: [number, number] = [0, 100];
		expect(changeY(0, span, band)).toBeCloseTo(50, 5);
		expect(changeY(10, span, band)).toBeCloseTo(0, 5);
		expect(changeY(-10, span, band)).toBeCloseTo(100, 5);
	});

	it('clamps past the span rather than drawing outside the band', () => {
		expect(changeY(999, 10, [0, 100])).toBe(changeY(10, 10, [0, 100]));
	});

	it('rounds the span out to a readable step and never collapses', () => {
		expect(changeSpan([year({ deltaPct: 3, baseDeltaPct: 1 })])).toBe(5);
		expect(changeSpan([year({ deltaPct: 12, baseDeltaPct: 1 })])).toBe(15);
		expect(changeSpan([year({ deltaPct: null, baseDeltaPct: null })])).toBe(5);
	});

	it('accounts for a fall as much as a rise', () => {
		expect(changeSpan([year({ deltaPct: -22, baseDeltaPct: null })])).toBe(25);
	});
});

describe('changeRuns', () => {
	const rows = [
		year({ year: 2023, deltaPct: null }),
		year({ year: 2024, deltaPct: 6 }),
		year({ year: 2025, deltaPct: 4 })
	];

	it('breaks the run where a year has no comparable figure', () => {
		// The first year on record has nothing to compare against, and a line
		// drawn through it would assert a change that was never computed.
		const runs = changeRuns(rows, (r) => r.deltaPct, 10, [0, 100]);
		expect(runs).toHaveLength(1);
		expect(runs[0].map((p) => p.year)).toEqual([2024, 2025]);
	});

	it('returns nothing when no year has a figure', () => {
		expect(changeRuns(rows, () => null, 10, [0, 100])).toEqual([]);
	});

	it('carries the percentage through for the readout', () => {
		const runs = changeRuns(rows, (r) => r.deltaPct, 10, [0, 100]);
		expect(runs[0][0].pct).toBe(6);
	});
});
