// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
	BOTTOM,
	TOP,
	X_LEFT,
	X_RIGHT,
	axisTicks,
	barWidth,
	barsFor,
	ceilingFor,
	keptPct,
	slotFor,
	type MonthBar
} from '$lib/charts/month-history-geometry';

function span(start: string, count: number): string[] {
	const [y, m] = start.split('-').map(Number);
	return Array.from({ length: count }, (_, i) => {
		const total = y * 12 + (m - 1) + i;
		return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
	});
}

const month = (m: string, earned: number, spent: number): MonthBar => ({ month: m, earned, spent });

describe('slotFor', () => {
	it('centres a month in its share of the plot', () => {
		expect(slotFor(0, 2)).toBeCloseTo(X_LEFT + (X_RIGHT - X_LEFT) / 4);
		expect(slotFor(1, 2)).toBeCloseTo(X_LEFT + ((X_RIGHT - X_LEFT) * 3) / 4);
	});
});

describe('barWidth', () => {
	it('caps a short record so two months are bars, not slabs', () => {
		expect(barWidth(2)).toBe(26);
	});

	it('shrinks with the record, never to nothing', () => {
		expect(barWidth(120)).toBeLessThan(26);
		expect(barWidth(10_000)).toBeGreaterThanOrEqual(1);
	});
});

describe('ceilingFor', () => {
	it('takes the tallest single figure, earned or spent', () => {
		expect(ceilingFor([month('2026-01', 100, 40), month('2026-02', 30, 260)])).toBe(260);
	});

	it('is zero on an empty record rather than -Infinity', () => {
		expect(ceilingFor([])).toBe(0);
	});
});

describe('barsFor', () => {
	const months = [month('2026-01', 100, 50)];

	it('sits both bars on the baseline, earned left of spent', () => {
		const [earned, spent] = barsFor(months[0], 0, 1, 100);
		expect(earned.kind).toBe('in');
		expect(spent.kind).toBe('out');
		expect(earned.x).toBeLessThan(spent.x);
		expect(earned.y + earned.height).toBeCloseTo(BOTTOM);
		expect(spent.y + spent.height).toBeCloseTo(BOTTOM);
	});

	it('gives the ceiling the full panel', () => {
		const [earned] = barsFor(months[0], 0, 1, 100);
		expect(earned.height).toBeCloseTo(BOTTOM - TOP);
		expect(earned.y).toBeCloseTo(TOP);
	});

	it('keeps a figure orders below the rest visible', () => {
		const [earned] = barsFor(month('2026-01', 1, 0), 0, 1, 10_000_000);
		expect(earned.height).toBeGreaterThan(0);
	});

	// A month with no income at all is not a month with a little of it.
	it('draws nothing for a true zero', () => {
		const [earned, spent] = barsFor(month('2026-01', 0, 500), 0, 1, 500);
		expect(earned.height).toBe(0);
		expect(spent.height).toBeGreaterThan(0);
	});

	it('draws nothing at all before anything is imported', () => {
		expect(barsFor(month('2026-01', 0, 0), 0, 1, 0).every((b) => b.height === 0)).toBe(true);
	});
});

describe('keptPct', () => {
	it('reports what survived, as a share of what came in', () => {
		expect(keptPct(month('2026-01', 200, 50))).toBe(75);
	});

	it('goes negative on a month that spent more than it earned', () => {
		expect(keptPct(month('2026-01', 100, 150))).toBe(-50);
	});

	// −∞ and −100% would both be inventions.
	it('has no answer for a month that earned nothing', () => {
		expect(keptPct(month('2026-01', 0, 150))).toBeNull();
	});
});

describe('axisTicks', () => {
	it('puts a month label under its own bar', () => {
		const months = span('2026-05', 3);
		expect(axisTicks(months).map((t) => t.label)).toEqual(['05', '06', '07']);
		expect(axisTicks(months).map((t) => t.x)).toEqual([0, 1, 2].map((i) => slotFor(i, 3)));
	});

	it('centres a year label over the months belonging to it', () => {
		// Two years or more is where the axis switches to year labels. Starting in
		// July gives 2025 six months against 2026's twelve — the uneven case an
		// evenly spread axis got wrong, printing 2025 over a 2026 month.
		const months = span('2025-07', 30);
		const [first, second, third] = axisTicks(months);
		expect([first.label, second.label, third.label]).toEqual(['2025', '2026', '2027']);
		expect(first.x).toBeCloseTo((slotFor(0, 30) + slotFor(5, 30)) / 2);
		expect(second.x).toBeCloseTo((slotFor(6, 30) + slotFor(17, 30)) / 2);
		expect(third.x).toBeCloseTo((slotFor(18, 30) + slotFor(29, 30)) / 2);
	});

	it('has nothing to place on an empty record', () => {
		expect(axisTicks([])).toEqual([]);
	});
});
