import { describe, expect, it } from 'vitest';
import { buildSankey, type SankeyGraph } from '$lib/charts/sankey';

// A four-column graph shaped like the real one: two sources into a total, the
// total into groups, one group into leaves.
const graph: SankeyGraph = {
	nodes: [
		{ key: 'salary', label: 'Salary', value: 372_000, colorVar: '--green', column: 0 },
		{ key: 'rent', label: 'Rent received', value: 99_000, colorVar: '--green', column: 0 },
		{ key: 'income', label: 'Income', value: 471_000, colorVar: '--green', column: 1 },
		{ key: 'housing', label: 'Housing', value: 355_836, colorVar: '--blue', column: 2 },
		{ key: 'living', label: 'Food & lifestyle', value: 74_289, colorVar: '--purple', column: 2 },
		{ key: 'kept', label: 'Saved & invested', value: 40_875, colorVar: '--teal', column: 2 },
		{ key: 'mortgage', label: 'Mortgage', value: 326_736, colorVar: '--blue', column: 3 },
		{ key: 'svj', label: 'SVJ & insurance', value: 29_100, colorVar: '--blue', column: 3 }
	],
	links: [
		{ from: 'salary', to: 'income', value: 372_000 },
		{ from: 'rent', to: 'income', value: 99_000 },
		{ from: 'income', to: 'housing', value: 355_836 },
		{ from: 'income', to: 'living', value: 74_289 },
		{ from: 'income', to: 'kept', value: 40_875 },
		{ from: 'housing', to: 'mortgage', value: 326_736 },
		{ from: 'housing', to: 'svj', value: 29_100 }
	]
};

const SIZES = [
	{ width: 1240, height: 560 },
	{ width: 900, height: 460 },
	{ width: 640, height: 380 },
	{ width: 560, height: 320 }
];

describe.each(SIZES)('laid out at $width × $height', (box) => {
	const layout = buildSankey(graph, box);

	// The complaint that started this: one fixed layout scaled to fit, so the
	// type shrank with the box. The geometry has to come from the box instead.
	it('fills the box it was given', () => {
		expect(layout.width).toBe(box.width);
		expect(layout.height).toBe(box.height);
	});

	it('draws nothing outside the box', () => {
		for (const node of layout.nodes) {
			expect(node.x).toBeGreaterThanOrEqual(0);
			expect(node.x + node.w).toBeLessThanOrEqual(box.width);
			expect(node.y).toBeGreaterThanOrEqual(0);
			expect(node.y + node.h).toBeLessThanOrEqual(box.height + 0.001);
		}
	});

	// Conservation is the adapter's job, not a general graph engine's: a group
	// with no leaves broken out simply has no node in the last column. What the
	// engine must not do is invent value or overflow the scale.
	it('never draws a column heavier than the graph total', () => {
		const byColumn = new Map<number, number>();
		for (const node of layout.nodes) {
			byColumn.set(node.column, (byColumn.get(node.column) ?? 0) + node.value);
		}
		for (const [, total] of byColumn) expect(total).toBeLessThanOrEqual(471_000 + 0.5);
		expect(byColumn.get(0)).toBeCloseTo(471_000, 0);
	});

	// A column of two nodes with the same total as a column of five must reach
	// the same height, or the diagram lies about proportion.
	it('scales every column by one factor', () => {
		const height = (column: number) =>
			layout.nodes.filter((n) => n.column === column).reduce((sum, n) => sum + n.h, 0);
		expect(height(0)).toBeCloseTo(height(2), 0);
	});

	it('starts ribbons and ends them flush with their nodes', () => {
		for (const ribbon of layout.ribbons) {
			const from = layout.nodes.find((n) => n.key === ribbon.from)!;
			const to = layout.nodes.find((n) => n.key === ribbon.to)!;
			expect(ribbon.x0).toBeCloseTo(from.x + from.w, 3);
			expect(ribbon.x1).toBeCloseTo(to.x, 3);
			expect(ribbon.y0).toBeGreaterThanOrEqual(from.y - 0.001);
			expect(ribbon.y0 + ribbon.thickness).toBeLessThanOrEqual(from.y + from.h + 0.001);
			expect(ribbon.y1).toBeGreaterThanOrEqual(to.y - 0.001);
			expect(ribbon.y1 + ribbon.thickness).toBeLessThanOrEqual(to.y + to.h + 0.001);
		}
	});

	it('never overlaps two labels in the same column', () => {
		for (const column of new Set(layout.labels.map((l) => l.column))) {
			const sorted = layout.labels.filter((l) => l.column === column).sort((a, b) => a.y - b.y);
			for (let i = 1; i < sorted.length; i++) {
				expect(sorted[i].y - sorted[i - 1].y).toBeGreaterThanOrEqual(sorted[i - 1].height);
			}
		}
	});
});

describe('buildSankey', () => {
	it('gives the same picture for the same graph', () => {
		const box = { width: 900, height: 460 };
		expect(buildSankey(graph, box)).toEqual(buildSankey(graph, box));
	});

	it('puts each column in its own vertical band, left to right', () => {
		const layout = buildSankey(graph, { width: 1000, height: 500 });
		const x = (column: number) => layout.nodes.find((n) => n.column === column)!.x;
		expect(x(0)).toBeLessThan(x(1));
		expect(x(1)).toBeLessThan(x(2));
		expect(x(2)).toBeLessThan(x(3));
	});

	it('survives a graph with a single node', () => {
		const layout = buildSankey(
			{ nodes: [{ key: 'a', label: 'A', value: 10, colorVar: '--teal', column: 0 }], links: [] },
			{ width: 400, height: 200 }
		);
		expect(layout.nodes).toHaveLength(1);
		expect(layout.ribbons).toHaveLength(0);
	});

	it('refuses to divide by a zero total rather than drawing NaN', () => {
		const layout = buildSankey(
			{ nodes: [{ key: 'a', label: 'A', value: 0, colorVar: '--teal', column: 0 }], links: [] },
			{ width: 400, height: 200 }
		);
		expect(Number.isFinite(layout.nodes[0].h)).toBe(true);
	});
});

// The right-hand labels are drawn outside the last node, so the box has to
// reserve room for them. A fixed gutter clipped the longer names against the
// card edge at moderate widths.
describe('label gutters', () => {
	it('keeps the outer columns clear of the box edges at every size', () => {
		for (const box of SIZES) {
			const layout = buildSankey(graph, box);
			const columns = [...new Set(layout.nodes.map((n) => n.column))].sort((a, b) => a - b);
			const firstX = Math.min(
				...layout.nodes.filter((n) => n.column === columns[0]).map((n) => n.x)
			);
			const lastNode = layout.nodes.filter((n) => n.column === columns[columns.length - 1])[0];
			expect(firstX).toBeGreaterThanOrEqual(112);
			expect(box.width - (lastNode.x + lastNode.w)).toBeGreaterThanOrEqual(112);
		}
	});
});
