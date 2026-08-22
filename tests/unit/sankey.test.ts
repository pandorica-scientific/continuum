import { describe, expect, it } from 'vitest';
import { flowGraph } from '$lib/charts/flow-graph';
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

/**
 * Ribbons crossing each other was reported from a real cash flow, and the file
 * explained why on its own: the ordering comment promised "two median sweeps"
 * and the code did one forward pass. A forward pass places a node before
 * anything downstream of it exists, so nothing could ever settle a column by
 * where its children ended up.
 */
describe('crossings', () => {
	/** Two ribbons cross when their ends are ordered oppositely. */
	function crossings(ribbons: { x0: number; y0: number; y1: number }[]): number {
		let count = 0;
		for (let i = 0; i < ribbons.length; i++) {
			for (let j = i + 1; j < ribbons.length; j++) {
				const a = ribbons[i];
				const b = ribbons[j];
				// Only ribbons spanning the same gap can cross.
				if (a.x0 !== b.x0) continue;
				if ((a.y0 - b.y0) * (a.y1 - b.y1) < 0) count += 1;
			}
		}
		return count;
	}

	// Measured, not assumed. The first version of this test asserted zero
	// crossings on a graph that had none either way — it passed with the sweep
	// disabled, which makes it a test of nothing. This shape has three crossings
	// without the backward sweep and none with it.
	it('untangles a column whose children are declared in the opposite order', () => {
		const graph = {
			nodes: [
				{ key: 'in', label: 'Income', value: 90, colorVar: '--green', column: 0 },
				{ key: 'a', label: 'A', value: 30, colorVar: '--blue', column: 1 },
				{ key: 'b', label: 'B', value: 30, colorVar: '--teal', column: 1 },
				{ key: 'c', label: 'C', value: 30, colorVar: '--purple', column: 1 },
				{ key: 'x', label: 'X', value: 30, colorVar: '--blue', column: 2 },
				{ key: 'y', label: 'Y', value: 30, colorVar: '--teal', column: 2 },
				{ key: 'z', label: 'Z', value: 30, colorVar: '--purple', column: 2 }
			],
			links: [
				{ from: 'in', to: 'a', value: 30 },
				{ from: 'in', to: 'b', value: 30 },
				{ from: 'in', to: 'c', value: 30 },
				// The leaves are declared in reverse, so ordering column 1 by its
				// parents alone — all three share one — leaves every ribbon crossing.
				{ from: 'c', to: 'x', value: 30 },
				{ from: 'b', to: 'y', value: 30 },
				{ from: 'a', to: 'z', value: 30 }
			]
		};

		const layout = buildSankey(graph, { width: 800, height: 300 });
		expect(crossings(layout.ribbons)).toBe(0);
	});

	// The shape that was reported: four income sources, seven groups and a long
	// tail of small leaves. Ordered by value alone — which is what the code was
	// really doing, because its "forward pass" read a map that had not been
	// filled yet — this draws 57 crossings. With the sweeps it draws none.
	it('draws a household cash flow without a single crossing', () => {
		// Shaped like the screenshot: four income sources, seven groups, and the
		// long tail of small leaves that was fanning out and crossing.
		const input = {
			sources: [
				{ name: 'Salary', amount: 33237 },
				{ name: 'Rent received', amount: 6000 },
				{ name: 'Reimbursements', amount: 4500 },
				{ name: 'Interest', amount: 989 }
			],
			stages: [
				{ key: 'taxes', label: 'Taxes & fees', colorVar: '--a', amount: 16150 },
				{ key: 'living', label: 'Food & lifestyle', colorVar: '--b', amount: 14277 },
				{ key: 'bills', label: 'Bills & utilities', colorVar: '--c', amount: 4170 },
				{ key: 'transport', label: 'Transport', colorVar: '--d', amount: 3524 },
				{ key: 'housing', label: 'Housing', colorVar: '--e', amount: 5377 },
				{ key: 'health', label: 'Health & care', colorVar: '--f', amount: 203 },
				{ key: 'subs', label: 'Subscriptions', colorVar: '--g', amount: 380 }
			],
			remainderLabel: 'Saved & invested',
			kept: 3885,
			breakdown: [
				{
					key: 'living',
					leaves: [
						{ name: 'Groceries', value: 1523 },
						{ name: 'Eating out', value: 1420 },
						{ name: 'Travel', value: 655 },
						{ name: 'Kids', value: 696 },
						{ name: 'Dog', value: 196 },
						{ name: 'Entertainment', value: 40 },
						{ name: 'Home', value: 1501 },
						{ name: 'Presents', value: 128 },
						{ name: 'Clothes', value: 167 },
						{ name: 'Everything else', value: 7946 }
					]
				},
				{
					key: 'bills',
					leaves: [
						{ name: 'Energy', value: 162 },
						{ name: 'Phone', value: 66 },
						{ name: 'Rent', value: 3942 }
					]
				},
				{
					key: 'transport',
					leaves: [
						{ name: 'Car loan', value: 3188 },
						{ name: 'Fuel & tolls', value: 137 },
						{ name: 'Maintenance', value: 198 }
					]
				},
				{
					key: 'health',
					leaves: [
						{ name: 'Pharmacy', value: 135 },
						{ name: 'Hairdresser', value: 67 }
					]
				},
				{ key: 'housing', leaves: [{ name: 'Mortgage · rental', value: 5377 }] },
				{ key: 'kept', leaves: [{ name: 'Cash buffer', value: 3885 }] }
			]
		};
		const layout = buildSankey(flowGraph(input, 4), { width: 1240, height: 560 });

		expect(layout.ribbons.length).toBeGreaterThan(30);
		expect(crossings(layout.ribbons)).toBe(0);
	});

	// Ten percent of its column. Height alone was the wrong test: on a tall chart
	// a one-percent sliver clears any pixel threshold and still names something
	// invisible. Everything else is in the breakdown strip and on hover.
	it('names only the bands worth reading off the diagram', () => {
		// Shaped like the screenshot: four income sources, seven groups, and the
		// long tail of small leaves that was fanning out and crossing.
		const input = {
			sources: [
				{ name: 'Salary', amount: 33237 },
				{ name: 'Rent received', amount: 6000 },
				{ name: 'Reimbursements', amount: 4500 },
				{ name: 'Interest', amount: 989 }
			],
			stages: [
				{ key: 'taxes', label: 'Taxes & fees', colorVar: '--a', amount: 16150 },
				{ key: 'living', label: 'Food & lifestyle', colorVar: '--b', amount: 14277 },
				{ key: 'bills', label: 'Bills & utilities', colorVar: '--c', amount: 4170 },
				{ key: 'transport', label: 'Transport', colorVar: '--d', amount: 3524 },
				{ key: 'housing', label: 'Housing', colorVar: '--e', amount: 5377 },
				{ key: 'health', label: 'Health & care', colorVar: '--f', amount: 203 },
				{ key: 'subs', label: 'Subscriptions', colorVar: '--g', amount: 380 }
			],
			remainderLabel: 'Saved & invested',
			kept: 3885,
			breakdown: [
				{
					key: 'living',
					leaves: [
						{ name: 'Groceries', value: 1523 },
						{ name: 'Eating out', value: 1420 },
						{ name: 'Travel', value: 655 },
						{ name: 'Kids', value: 696 },
						{ name: 'Dog', value: 196 },
						{ name: 'Entertainment', value: 40 },
						{ name: 'Home', value: 1501 },
						{ name: 'Presents', value: 128 },
						{ name: 'Clothes', value: 167 },
						{ name: 'Everything else', value: 7946 }
					]
				},
				{
					key: 'bills',
					leaves: [
						{ name: 'Energy', value: 162 },
						{ name: 'Phone', value: 66 },
						{ name: 'Rent', value: 3942 }
					]
				},
				{
					key: 'transport',
					leaves: [
						{ name: 'Car loan', value: 3188 },
						{ name: 'Fuel & tolls', value: 137 },
						{ name: 'Maintenance', value: 198 }
					]
				},
				{
					key: 'health',
					leaves: [
						{ name: 'Pharmacy', value: 135 },
						{ name: 'Hairdresser', value: 67 }
					]
				},
				{ key: 'housing', leaves: [{ name: 'Mortgage · rental', value: 5377 }] },
				{ key: 'kept', leaves: [{ name: 'Cash buffer', value: 3885 }] }
			]
		};
		const layout = buildSankey(flowGraph(input, 4), { width: 1240, height: 560 });
		const drawn = layout.labels.filter((l) => l.fits).map((l) => l.label);

		expect(drawn).toContain('Taxes & fees');
		expect(drawn).toContain('Food & lifestyle');
		// 380 of roughly 48 000 in its column.
		expect(drawn).not.toContain('Subscriptions');
		expect(drawn.length).toBeLessThan(layout.labels.length / 3);
	});

	it('stacks a node’s incoming bands by where they came from', () => {
		// Two sources into one target. The bands must arrive in the order the
		// sources sit in, or they cross each other inside the target.
		const graph = {
			nodes: [
				{ key: 'top', label: 'Top', value: 30, colorVar: '--green', column: 0 },
				{ key: 'bottom', label: 'Bottom', value: 70, colorVar: '--green', column: 0 },
				{ key: 'pot', label: 'Pot', value: 100, colorVar: '--blue', column: 1 }
			],
			links: [
				{ from: 'bottom', to: 'pot', value: 70 },
				{ from: 'top', to: 'pot', value: 30 }
			]
		};

		const layout = buildSankey(graph, { width: 800, height: 300 });
		const at = (key: string) => layout.nodes.find((n) => n.key === key)!;
		const ribbon = (from: string) => layout.ribbons.find((r) => r.from === from)!;

		// Whichever way the sources ended up stacked, the arrivals follow suit.
		const sourcesInOrder = at('top').y < at('bottom').y ? ['top', 'bottom'] : ['bottom', 'top'];
		expect(ribbon(sourcesInOrder[0]).y1).toBeLessThan(ribbon(sourcesInOrder[1]).y1);
		expect(crossings(layout.ribbons)).toBe(0);
	});
});
