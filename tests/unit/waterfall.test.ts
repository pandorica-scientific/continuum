import { describe, expect, it } from 'vitest';
import { buildWaterfall, relaxLabels, H, type WaterfallInput } from '$lib/charts/waterfall';

// Realistic magnitudes from the design fixtures (year-to-date, CZK).
const REALISTIC: WaterfallInput = {
	sources: [
		{ name: 'Salary · Robert', amount: 644000 },
		{ name: 'Salary · Tereza', amount: 483000 },
		{ name: 'Rent · Brno', amount: 115500 },
		{ name: 'Dividends', amount: 41300 }
	],
	stages: [
		{ key: 'taxes', label: 'Taxes & fees', after: 'After tax', colorVar: '--red', amount: 34800 },
		{
			key: 'bills',
			label: 'Bills & utilities',
			after: 'After bills',
			colorVar: '--orange',
			amount: 118300
		},
		{
			key: 'transport',
			label: 'Transport',
			after: 'After transport',
			colorVar: '--yellow',
			amount: 96500
		},
		{
			key: 'living',
			label: 'Food & lifestyle',
			after: 'After living',
			colorVar: '--purple',
			amount: 305700
		},
		{
			key: 'housing',
			label: 'Housing',
			after: 'Saved & invested',
			colorVar: '--blue',
			amount: 431200
		}
	],
	remainderLabel: 'Saved & invested'
};

// A hostile case: one tiny source squeezed between large ones, thin stages.
const THIN: WaterfallInput = {
	sources: [
		{ name: 'A', amount: 900000 },
		{ name: 'B', amount: 1200 },
		{ name: 'C', amount: 1100 },
		{ name: 'D', amount: 850000 }
	],
	stages: [
		{ key: 'taxes', label: 'Taxes & fees', after: 'After tax', colorVar: '--red', amount: 900 },
		{
			key: 'bills',
			label: 'Bills & utilities',
			after: 'After bills',
			colorVar: '--orange',
			amount: 700
		},
		{
			key: 'transport',
			label: 'Transport',
			after: 'After transport',
			colorVar: '--yellow',
			amount: 800
		},
		{
			key: 'living',
			label: 'Food & lifestyle',
			after: 'After living',
			colorVar: '--purple',
			amount: 600
		},
		{ key: 'housing', label: 'Housing', after: 'Saved & invested', colorVar: '--blue', amount: 500 }
	],
	remainderLabel: 'Saved & invested'
};

const LINE = 26;
const EDGE = 16;

function assertInvariants(input: WaterfallInput) {
	const layout = buildWaterfall(input);

	// 1. Zero clipped labels.
	for (const label of layout.labels) {
		expect(label.y).toBeGreaterThanOrEqual(EDGE);
		expect(label.y).toBeLessThanOrEqual(H - EDGE);
	}

	// 2. Zero collisions within any left-anchored or right-anchored column.
	for (const anchor of ['left', 'right'] as const) {
		const byX = new Map<number, number[]>();
		for (const l of layout.labels.filter((l) => l.anchor === anchor)) {
			if (!byX.has(l.x)) byX.set(l.x, []);
			byX.get(l.x)!.push(l.y);
		}
		for (const ys of byX.values()) {
			const sorted = [...ys].sort((a, b) => a - b);
			for (let i = 1; i < sorted.length; i++) {
				expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(LINE - 0.001);
			}
		}
	}

	// 3. Every node fits the canvas.
	for (const node of layout.nodes) {
		expect(node.y).toBeGreaterThanOrEqual(0);
		expect(node.y + node.h).toBeLessThanOrEqual(H);
	}

	return layout;
}

describe('buildWaterfall', () => {
	it('holds the invariants on realistic data', () => {
		const layout = assertInvariants(REALISTIC);
		// 4 sources + 6 trunk labels (Income, 4 after-stages, remainder) + 5 expenses
		expect(layout.labels).toHaveLength(15);
	});

	it('holds the invariants on hostile thin-band data', () => {
		assertInvariants(THIN);
	});

	it('drifts at most 5px (render space) from band centres on realistic data', () => {
		const layout = buildWaterfall(REALISTIC);
		// 5px at the 592px render is 5 × (H/592) svg units.
		const maxDrift = 5 * (H / 592);
		const sourceLabels = layout.labels.filter((l) => l.anchor === 'right');
		const sourceNodes = layout.nodes.slice(0, REALISTIC.sources.length);
		sourceLabels.forEach((label, i) => {
			const centre = sourceNodes[i].y + sourceNodes[i].h / 2;
			expect(Math.abs(label.y - centre)).toBeLessThanOrEqual(maxDrift);
		});
	});

	it('returns an empty layout for zero income', () => {
		const layout = buildWaterfall({ sources: [], stages: [], remainderLabel: 'x' });
		expect(layout.paths).toHaveLength(0);
	});

	it('trunk and fan-in opacity match exactly (no seam)', () => {
		const layout = buildWaterfall(REALISTIC);
		const greens = layout.paths.filter((p) => p.colorVar === '--green');
		expect(new Set(greens.map((p) => p.opacity)).size).toBe(1);
	});
});

describe('relaxLabels', () => {
	it('leaves well-spaced labels alone', () => {
		expect(relaxLabels([100, 200, 300], 26, 0, 860)).toEqual([100, 200, 300]);
	});

	it('spreads colliding labels around their block mean', () => {
		const out = relaxLabels([100, 104, 108], 26, 0, 860);
		expect(out[1]).toBeCloseTo(104, 5);
		expect(out[1] - out[0]).toBeCloseTo(26, 5);
		expect(out[2] - out[1]).toBeCloseTo(26, 5);
	});

	it('clamps blocks at the edges', () => {
		const out = relaxLabels([2, 4], 26, 0, 860);
		expect(out[0]).toBeGreaterThanOrEqual(0);
		expect(out[1] - out[0]).toBeGreaterThanOrEqual(26);
	});

	it('preserves input order mapping', () => {
		const out = relaxLabels([300, 100], 26, 0, 860);
		expect(out[0]).toBeGreaterThan(out[1]);
	});
});
