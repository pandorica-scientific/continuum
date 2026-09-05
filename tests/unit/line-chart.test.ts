// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { axisTicks, lineGeometry, niceStep, PAD_LEFT, PAD_RIGHT } from '../../src/lib/charts/line';

describe('nice steps', () => {
	it('rounds up to 1, 2, 2.5 or 5 times a power of ten', () => {
		expect(niceStep(0.8)).toBe(1);
		expect(niceStep(1.4)).toBe(2);
		expect(niceStep(2.2)).toBe(2.5);
		expect(niceStep(4)).toBe(5);
		expect(niceStep(7)).toBe(10);
		expect(niceStep(1400)).toBe(2000);
	});

	it('keeps 2.5, which is what stops 240 jumping from 200 to 500', () => {
		expect(niceStep(240)).toBe(250);
	});

	it('survives a degenerate range rather than dividing by zero', () => {
		expect(niceStep(0)).toBe(1);
		expect(niceStep(-5)).toBe(1);
	});
});

describe('the axis', () => {
	it('always includes zero, so a change is not exaggerated by a raised floor', () => {
		const axis = axisTicks(980, 1000);
		expect(axis.min).toBe(0);
		expect(axis.ticks[0]).toBe(0);
	});

	it('leaves headroom above the tallest point', () => {
		const axis = axisTicks(0, 100);
		expect(axis.max).toBeGreaterThan(100);
	});

	it('extends below zero when the data does', () => {
		const axis = axisTicks(-40, 100);
		expect(axis.min).toBeLessThan(0);
	});

	it('gives a flat series an axis rather than a division by zero', () => {
		const axis = axisTicks(0, 0);
		expect(axis.max).toBeGreaterThan(axis.min);
		expect(axis.ticks.length).toBeGreaterThan(1);
	});
});

describe('laying a line out', () => {
	const series = [
		{
			key: 'net',
			colorVar: '--blue',
			endLabel: 'Net',
			points: [{ value: 10 }, { value: 20 }, { value: 30 }]
		}
	];

	it('insets the first and last points from the plot edges', () => {
		const g = lineGeometry(series, 800, 300);
		const first = g.series[0].points[0];
		const last = g.series[0].points[2];
		expect(first.x).toBeGreaterThan(g.plot.x);
		expect(last.x).toBeLessThan(g.plot.x + g.plot.w);
	});

	it('leaves room for the axis on the left and the end label on the right', () => {
		const g = lineGeometry(series, 800, 300);
		expect(g.plot.x).toBe(PAD_LEFT);
		expect(g.plot.w).toBe(800 - PAD_LEFT - PAD_RIGHT);
	});

	it('draws a higher value further up the box', () => {
		const g = lineGeometry(series, 800, 300);
		const [a, , c] = g.series[0].points;
		expect(c.y).toBeLessThan(a.y);
	});

	it('breaks the line at a null rather than drawing through zero', () => {
		const g = lineGeometry(
			[
				{
					key: 'gappy',
					colorVar: '--blue',
					points: [{ value: 1 }, { value: 2 }, { value: null }, { value: 4 }, { value: 5 }]
				}
			],
			800,
			300
		);
		expect(g.series[0].paths).toHaveLength(2);
		// The gap is missing from the points too, so no dot is drawn in mid-air.
		expect(g.series[0].points).toHaveLength(4);
	});

	it('draws no zero line for one-signed data, and one when it crosses', () => {
		expect(lineGeometry(series, 800, 300).zeroY).toBeNull();
		const crossing = lineGeometry(
			[{ key: 'a', colorVar: '--blue', points: [{ value: -5 }, { value: 5 }] }],
			800,
			300
		);
		expect(crossing.zeroY).not.toBeNull();
	});

	it('centres a single point rather than pinning it to the left edge', () => {
		const g = lineGeometry([{ key: 'a', colorVar: '--blue', points: [{ value: 3 }] }], 800, 300);
		expect(g.series[0].points[0].x).toBeCloseTo(g.plot.x + g.plot.w / 2);
	});

	it('says a series is entirely null rather than pretending it ends somewhere', () => {
		const g = lineGeometry(
			[{ key: 'a', colorVar: '--blue', points: [{ value: null }, { value: null }] }],
			800,
			300
		);
		expect(g.series[0].end).toBeNull();
		expect(g.series[0].paths).toEqual([]);
	});

	it('survives a box too small to have a plot at all', () => {
		const g = lineGeometry(series, 40, 10);
		expect(g.plot.w).toBe(0);
		expect(g.plot.h).toBe(0);
	});
});

describe('bars beside the line', () => {
	const line = [{ key: 'pct', colorVar: '--blue', points: [{ value: 5 }, { value: 10 }] }];
	const bars = [
		{ segments: [{ value: 100, fill: 'var(--teal)' }], tick: 60 },
		{
			segments: [
				{ value: 80, fill: 'var(--teal)' },
				{ value: 40, fill: 'url(#hatch)' }
			]
		}
	];

	it('draws nothing bar-shaped when no bars were passed', () => {
		const g = lineGeometry(line, 800, 300);
		expect(g.bars).toEqual([]);
		expect(g.barTicks).toEqual([]);
	});

	it('gives the bars their own band above the line, with a gap between', () => {
		const g = lineGeometry(line, 800, 300, { bars, barShare: 0.7 });
		const lowestBar = Math.max(...g.bars.flatMap((b) => b.segments.map((s) => s.y + s.h)));
		const highestPoint = Math.min(...g.series[0].points.map((p) => p.y));
		expect(lowestBar).toBeLessThan(highestPoint);
		expect(g.splitY).toBeGreaterThan(g.plot.y);
	});

	it('scales the bars on their own axis, not the one the line uses', () => {
		// The line tops out at 10 and the bars at 120; a shared axis would put
		// the line flat on the floor.
		const g = lineGeometry(line, 800, 300, { bars, barShare: 0.7 });
		expect(g.barTicks.at(-1)!.value).toBeGreaterThanOrEqual(120);
		expect(g.ticks.at(-1)!.value).toBeLessThan(120);
	});

	it('stacks a segment on top of the one before it', () => {
		const g = lineGeometry(line, 800, 300, { bars, barShare: 0.7 });
		const [base, bonus] = g.bars[1].segments;
		// The bonus sits above the base: a smaller y, and they touch.
		expect(bonus.y).toBeLessThan(base.y);
		expect(bonus.y + bonus.h).toBeCloseTo(base.y, 5);
	});

	it('places the tick against the bar axis, and null where there is none', () => {
		const g = lineGeometry(line, 800, 300, { bars, barShare: 0.7 });
		expect(g.bars[0].tickY).not.toBeNull();
		expect(g.bars[1].tickY).toBeNull();
	});

	it('caps the bar width but never lets it vanish', () => {
		const wide = lineGeometry(line, 2000, 300, { bars, barShare: 0.7, maxBarWidth: 34 });
		expect(wide.bars[0].w).toBe(34);
		const crowded = lineGeometry(
			[{ key: 'a', colorVar: '--blue', points: Array(60).fill({ value: 1 }) }],
			400,
			300,
			{ bars: Array(60).fill({ segments: [{ value: 1, fill: 'var(--teal)' }] }), barShare: 0.7 }
		);
		expect(crowded.bars[0].w).toBeGreaterThanOrEqual(2);
	});

	it('gives every slot a hit zone the width of the pitch, not of the bar', () => {
		const g = lineGeometry(line, 800, 300, { bars, barShare: 0.7 });
		expect(g.hits).toHaveLength(2);
		expect(g.hits[0].w).toBeGreaterThan(g.bars[0].w);
	});

	it('still accepts a bare formatter, which is how the first callers pass one', () => {
		const g = lineGeometry(line, 800, 300, (v) => `${v}%`);
		expect(g.ticks[0].label).toBe('0%');
	});
});

describe('the two protections a stacked bar needs', () => {
	const line = [{ key: 'pct', colorVar: '--blue', points: [{ value: 5 }] }];

	it('gives a figure two orders below the rest a hairline rather than nothing', () => {
		// The €174 filing inside the €37 000 bar these charts were written for.
		const g = lineGeometry(line, 800, 400, {
			bars: [
				{
					segments: [
						{ value: 17400, fill: 'a' },
						{ value: 3700000, fill: 'b' }
					]
				}
			],
			barShare: 0.7
		});
		const [tiny] = g.bars[0].segments;
		expect(tiny.h).toBeGreaterThan(0);
	});

	it('takes the border off a segment too thin to carry one', () => {
		const g = lineGeometry(line, 800, 400, {
			bars: [
				{
					segments: [
						{ value: 1, fill: 'a', stroke: 'var(--teal)' },
						{ value: 100000, fill: 'b', stroke: 'var(--teal)' }
					]
				}
			],
			barShare: 0.7
		});
		// A 1px border on a sub-pixel rect paints a band at full strength, which
		// would make the least significant number the loudest thing in the bar.
		expect(g.bars[0].segments[0].stroke).toBeUndefined();
		expect(g.bars[0].segments[1].stroke).toBe('var(--teal)');
	});

	it('stacks in pixels, so the hairline floor is not undone by the next segment', () => {
		const g = lineGeometry(line, 800, 400, {
			bars: [
				{
					segments: [
						{ value: 1, fill: 'a' },
						{ value: 1, fill: 'b' },
						{ value: 100000, fill: 'c' }
					]
				}
			],
			barShare: 0.7
		});
		const [first, second] = g.bars[0].segments;
		expect(second.y + second.h).toBeCloseTo(first.y, 5);
	});
});
