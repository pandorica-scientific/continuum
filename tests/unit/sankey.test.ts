import { describe, expect, it } from 'vitest';
import { flowGraph, type FlowGraphInput } from '$lib/charts/flow-graph';
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

/**
 * A leaf column crowded enough that the box has a say in where its names go.
 * Every invariant below is asserted of this as well as the roomy graph above.
 */
const crowdedLeaves: SankeyGraph = {
	nodes: [
		{ key: 'salary', label: 'Salary', value: 25_000, colorVar: '--green', column: 0 },
		{ key: 'rent', label: 'Rent received', value: 6000, colorVar: '--green', column: 0 },
		{ key: 'income', label: 'Income', value: 31_000, colorVar: '--green', column: 1 },
		{ key: 'housing', label: 'Housing', value: 21_300, colorVar: '--blue', column: 2 },
		{ key: 'living', label: 'Food & lifestyle', value: 9100, colorVar: '--purple', column: 2 },
		{ key: 'kept', label: 'Saved & invested', value: 600, colorVar: '--teal', column: 2 },
		{
			key: 'principal',
			label: 'Mortgage ČS · principal',
			value: 12_000,
			colorVar: '--blue',
			column: 3
		},
		{
			key: 'interest',
			label: 'Mortgage ČS · interest',
			value: 9000,
			colorVar: '--blue',
			column: 3
		},
		{ key: 'svj', label: 'SVJ & insurance', value: 300, colorVar: '--blue', column: 3 },
		{ key: 'rest', label: 'Everything else', value: 5000, colorVar: '--purple', column: 3 },
		{ key: 'groceries', label: 'Groceries', value: 2500, colorVar: '--purple', column: 3 },
		{ key: 'eating', label: 'Eating out', value: 1600, colorVar: '--purple', column: 3 },
		{ key: 'buffer', label: 'Cash buffer', value: 600, colorVar: '--teal', column: 3 }
	],
	links: [
		{ from: 'salary', to: 'income', value: 25_000 },
		{ from: 'rent', to: 'income', value: 6000 },
		{ from: 'income', to: 'housing', value: 21_300 },
		{ from: 'income', to: 'living', value: 9100 },
		{ from: 'income', to: 'kept', value: 600 },
		{ from: 'housing', to: 'principal', value: 12_000 },
		{ from: 'housing', to: 'interest', value: 9000 },
		{ from: 'housing', to: 'svj', value: 300 },
		{ from: 'living', to: 'rest', value: 5000 },
		{ from: 'living', to: 'groceries', value: 2500 },
		{ from: 'living', to: 'eating', value: 1600 },
		{ from: 'kept', to: 'buffer', value: 600 }
	]
};

const SIZES = [
	{ width: 1240, height: 560 },
	{ width: 900, height: 460 },
	{ width: 640, height: 380 },
	{ width: 560, height: 320 }
];

const FIXTURES = [
	{ name: 'a graph with room to spare', subject: graph },
	{ name: 'a graph with a crowded leaf column', subject: crowdedLeaves }
];

describe.each(FIXTURES.flatMap((fixture) => SIZES.map((box) => ({ ...fixture, ...box }))))(
	'$name, laid out at $width × $height',
	({ subject, width, height }) => {
		const box = { width, height };
		const layout = buildSankey(subject, box);
		/** What the graph puts in one column, before the layout has had its say. */
		const asked = (column: number) =>
			subject.nodes.filter((n) => n.column === column).reduce((sum, n) => sum + n.value, 0);

		// Geometry must come from the box, not a fixed layout scaled to fit.
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

		// The engine must not invent value or overflow the scale.
		it('never draws a column heavier than the graph total', () => {
			const byColumn = new Map<number, number>();
			for (const node of layout.nodes) {
				byColumn.set(node.column, (byColumn.get(node.column) ?? 0) + node.value);
			}
			for (const [, total] of byColumn) expect(total).toBeLessThanOrEqual(asked(0) + 0.5);
			expect(byColumn.get(0)).toBeCloseTo(asked(0), 0);
		});

		// A column of two nodes with the same total as a column of five must reach
		// the same height, or the diagram lies about proportion.
		it('scales every column by one factor', () => {
			const drawn = (column: number) =>
				layout.nodes.filter((n) => n.column === column).reduce((sum, n) => sum + n.h, 0);
			expect(drawn(0)).toBeCloseTo(drawn(2), 0);
		});

		// Regression: holding ribbons back opened a channel for names but left bands
		// starting in mid-air, clear of the block they came from.
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

		// Unplated labels only live outside the first/last columns, where no flow runs
		// underneath. Middle columns carry a plate instead — asserted separately below.
		it('never lets a ribbon into the space an unplated label is drawn in', () => {
			for (const label of layout.labels.filter((l) => l.fits && !l.plate)) {
				const left = label.anchor === 'end' ? label.x - label.width : label.x;
				const right = left + label.width;
				for (const ribbon of layout.ribbons) {
					const clear = right <= ribbon.x0 + 0.001 || left >= ribbon.x1 - 0.001;
					expect(clear).toBe(true);
				}
			}
		});

		// A plate is drawn where — and only where — the name has flow beneath it.
		it('plates exactly the names that are drawn over the diagram', () => {
			const columns = [...new Set(layout.labels.map((l) => l.column))].sort((a, b) => a - b);
			for (const label of layout.labels) {
				const outside = label.column === columns[0] || label.column === columns[columns.length - 1];
				expect(label.plate).toBe(!outside);
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
	}
);

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

	// A thickness cannot be read back into a figure, so the value travels with the geometry.
	it('a ribbon carries the value of its link', () => {
		const layout = buildSankey(graph, { width: 1000, height: 500 });
		expect(layout.ribbons).toHaveLength(graph.links.length);
		for (const link of graph.links) {
			const ribbon = layout.ribbons.find((r) => r.from === link.from && r.to === link.to);
			expect(ribbon?.value).toBe(link.value);
		}
	});

	// Regression: guessing a name's width from its character count broke on any
	// font wider than the guess.
	describe('measuring names', () => {
		const box = { width: 900, height: 460 };
		const named = (layout: ReturnType<typeof buildSankey>) =>
			layout.labels.filter((l) => l.fits).map((l) => l.label);

		it('drops a name it cannot draw whole rather than cutting it', () => {
			// Every name measures wider than the diagram itself.
			const wide = buildSankey(graph, box, () => box.width * 2);
			expect(named(wide)).toEqual([]);
		});

		it('keeps the names when they measure narrow enough to fit', () => {
			const narrow = buildSankey(graph, box, () => 8);
			expect(named(narrow).length).toBeGreaterThan(0);
		});

		it('asks for the face each line is drawn in', () => {
			const kinds = new Set<string>();
			buildSankey(
				{
					nodes: [
						{
							key: 'a',
							label: 'A',
							value: 10,
							colorVar: '--teal',
							column: 0,
							showValue: true
						}
					],
					links: []
				},
				box,
				(_text, _font, kind) => {
					kinds.add(kind);
					return 10;
				}
			);
			expect([...kinds].sort()).toEqual(['name', 'value']);
		});
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

// Regression: the label margin used to be a fixed 112px, which clipped longer
// names and wasted space on short ones. It is measured from the names now.
/** One large source and four small ones, as a real household's income is. */
const crowdedSources: SankeyGraph = {
	nodes: [
		{ key: 'a', label: 'Salary', value: 33_237, colorVar: '--green', column: 0, showValue: true },
		{
			key: 'b',
			label: 'Rent received',
			value: 5845,
			colorVar: '--green',
			column: 0,
			showValue: true
		},
		{
			key: 'c',
			label: 'Reimbursements',
			value: 4363,
			colorVar: '--green',
			column: 0,
			showValue: true
		},
		{
			key: 'd',
			label: 'Other income',
			value: 1245,
			colorVar: '--green',
			column: 0,
			showValue: true
		},
		{ key: 'e', label: 'Interest', value: 34, colorVar: '--green', column: 0, showValue: true },
		{ key: 'in', label: 'Income', value: 44_724, colorVar: '--green', column: 1, showValue: true }
	],
	links: [
		{ from: 'a', to: 'in', value: 33_237 },
		{ from: 'b', to: 'in', value: 5845 },
		{ from: 'c', to: 'in', value: 4363 },
		{ from: 'd', to: 'in', value: 1245 },
		{ from: 'e', to: 'in', value: 34 }
	]
};

describe('label channels', () => {
	it('keeps every label inside the box at every size', () => {
		for (const box of SIZES) {
			const layout = buildSankey(graph, box);
			for (const label of layout.labels.filter((l) => l.fits)) {
				const left = label.anchor === 'end' ? label.x - label.width : label.x;
				expect(left).toBeGreaterThanOrEqual(-0.001);
				expect(left + label.width).toBeLessThanOrEqual(box.width + 0.001);
				expect(label.y).toBeGreaterThanOrEqual(-0.001);
				expect(label.y + label.height).toBeLessThanOrEqual(box.height + 0.001);
			}
		}
	});

	// Regression: clamping a block back inside the box could leave it colliding
	// with an unmoved block above it, since the clamp was applied per-block.
	it('settles a column whose blocks only collide once the box clamps them', () => {
		const box = { width: 1240, height: 560 };
		const layout = buildSankey(
			{
				nodes: [
					{ key: 'in', label: 'Income', value: 10_550, colorVar: '--green', column: 0 },
					{ key: 'rent', label: 'Rent', value: 10_000, colorVar: '--blue', column: 1 },
					{ key: 'energy', label: 'Energy', value: 500, colorVar: '--blue', column: 1 },
					{ key: 'phone', label: 'Phone', value: 50, colorVar: '--blue', column: 1 }
				],
				links: [
					{ from: 'in', to: 'rent', value: 10_000 },
					{ from: 'in', to: 'energy', value: 500 },
					{ from: 'in', to: 'phone', value: 50 }
				]
			},
			box
		);

		const column = layout.labels.filter((l) => l.column === 1).sort((a, b) => a.y - b.y);
		expect(column).toHaveLength(3);
		for (let i = 1; i < column.length; i++) {
			expect(column[i].y - column[i - 1].y).toBeGreaterThanOrEqual(column[i - 1].height);
		}
		// And settling did not simply push the pile out of the other end.
		expect(column[0].y).toBeGreaterThanOrEqual(0);
		const bottom = column[column.length - 1];
		expect(bottom.y + bottom.height).toBeLessThanOrEqual(box.height);
	});

	// Centring isn't always possible; a leader joins a displaced name back to its band.
	it('draws a leader from every name that could not stay level with its band', () => {
		const layout = buildSankey(crowdedSources, { width: 1240, height: 560 });
		let displaced = 0;

		for (const node of layout.nodes) {
			const label = layout.labels.find((l) => l.key === node.key)!;
			const drift = Math.abs(label.y + label.height / 2 - (node.y + node.h / 2));
			if (drift <= 1) {
				expect(label.leader).toBeNull();
				continue;
			}
			displaced += 1;
			expect(label.leader).not.toBeNull();
			// It starts on the band's own edge and ends where the name was put.
			expect(label.leader!.y1).toBeCloseTo(node.y + node.h / 2, 3);
			expect(label.leader!.y2).toBeCloseTo(label.y + label.height / 2, 3);
			expect(label.leader!.x2).toBeCloseTo(label.x, 3);
		}

		expect(displaced).toBeGreaterThan(0);
	});

	// A name is level with the middle of the band it names, in every column.
	it('centres every label on the band it names', () => {
		const layout = buildSankey(graph, { width: 1240, height: 560 });
		for (const node of layout.nodes) {
			const label = layout.labels.find((l) => l.key === node.key)!;
			expect(label.y + label.height / 2).toBeCloseTo(node.y + node.h / 2, 3);
		}
	});
});

/**
 * Regression: a forward pass places a node before anything downstream of it
 * exists, so it can never settle a column by where its children ended up.
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

	// This shape has three crossings without the backward sweep and none with it.
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
				// Leaves declared in reverse: ordering column 1 by its shared parent alone
				// would leave every ribbon crossing.
				{ from: 'c', to: 'x', value: 30 },
				{ from: 'b', to: 'y', value: 30 },
				{ from: 'a', to: 'z', value: 30 }
			]
		};

		const layout = buildSankey(graph, { width: 800, height: 300 });
		expect(crossings(layout.ribbons)).toBe(0);
	});

	// Ordered by value alone this draws 57 crossings; with the sweeps it draws none.
	it('draws a household cash flow without a single crossing', () => {
		const input: FlowGraphInput = {
			sources: [
				{ key: 'cat:salary', name: 'Salary', amount: 33237 },
				{ key: 'cat:rent-received', name: 'Rent received', amount: 6000 },
				{ key: 'cat:reimbursements', name: 'Reimbursements', amount: 4500 },
				{ key: 'cat:interest', name: 'Interest', amount: 989 }
			],
			stages: [
				{ key: 'taxes', label: 'Taxes & fees', colorVar: '--a', amount: 16150, role: 'expense' },
				{
					key: 'living',
					label: 'Food & lifestyle',
					colorVar: '--b',
					amount: 14277,
					role: 'expense'
				},
				{
					key: 'bills',
					label: 'Bills & utilities',
					colorVar: '--c',
					amount: 4170,
					role: 'expense'
				},
				{ key: 'transport', label: 'Transport', colorVar: '--d', amount: 3524, role: 'expense' },
				{ key: 'housing', label: 'Housing', colorVar: '--e', amount: 5377, role: 'expense' },
				{ key: 'health', label: 'Health & care', colorVar: '--f', amount: 203, role: 'expense' },
				{ key: 'subs', label: 'Subscriptions', colorVar: '--g', amount: 380, role: 'expense' }
			],
			keptLabel: 'Kept in cash',
			reservesLabel: 'From reserves',
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
				{ key: 'residual:kept', leaves: [{ name: 'Cash buffer', value: 3885 }] }
			]
		};
		const layout = buildSankey(flowGraph(input, 4), { width: 1240, height: 560 });

		expect(layout.ribbons.length).toBeGreaterThan(30);
		expect(crossings(layout.ribbons)).toBe(0);
	});

	// Regression: a fixed tenth-of-column threshold left seventeen bands nameless
	// on a real year. Type size now shrinks to fit what the column holds.
	it('names every band on a real cash flow, at one size per column', () => {
		const input: FlowGraphInput = {
			sources: [
				{ key: 'cat:salary', name: 'Salary', amount: 33237 },
				{ key: 'cat:rent-received', name: 'Rent received', amount: 6000 },
				{ key: 'cat:reimbursements', name: 'Reimbursements', amount: 4500 },
				{ key: 'cat:interest', name: 'Interest', amount: 989 }
			],
			stages: [
				{ key: 'taxes', label: 'Taxes & fees', colorVar: '--a', amount: 16150, role: 'expense' },
				{
					key: 'living',
					label: 'Food & lifestyle',
					colorVar: '--b',
					amount: 14277,
					role: 'expense'
				},
				{
					key: 'bills',
					label: 'Bills & utilities',
					colorVar: '--c',
					amount: 4170,
					role: 'expense'
				},
				{ key: 'transport', label: 'Transport', colorVar: '--d', amount: 3524, role: 'expense' },
				{ key: 'housing', label: 'Housing', colorVar: '--e', amount: 5377, role: 'expense' },
				{ key: 'health', label: 'Health & care', colorVar: '--f', amount: 203, role: 'expense' },
				{ key: 'subs', label: 'Subscriptions', colorVar: '--g', amount: 380, role: 'expense' }
			],
			keptLabel: 'Kept in cash',
			reservesLabel: 'From reserves',
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
				{ key: 'residual:kept', leaves: [{ name: 'Cash buffer', value: 3885 }] }
			]
		};
		const layout = buildSankey(flowGraph(input, 4), { width: 1240, height: 560 });

		expect(layout.labels).toHaveLength(33);
		expect(layout.labels.every((l) => l.fits)).toBe(true);
		// The income side is read as figures; spending figures are already in the breakdown strip.
		const shows = (column: number) => layout.labels.find((l) => l.column === column)!.showValue;
		expect(shows(0)).toBe(true);
		expect(shows(1)).toBe(true);
		expect(shows(2)).toBe(false);
		expect(shows(3)).toBe(false);
		// One size per column, so a column reads as a column.
		for (const column of [0, 1, 2, 3]) {
			const fonts = new Set(layout.labels.filter((l) => l.column === column).map((l) => l.font));
			expect(fonts.size).toBe(1);
		}
	});

	/** Thirteen names down one column, at values that make "biggest" mean something. */
	const crowded = (count: number) => ({
		nodes: [
			{
				key: 'in',
				label: 'Income',
				value: count * 10,
				colorVar: '--green',
				column: 0,
				showValue: true
			},
			...Array.from({ length: count }, (_, i) => ({
				key: `leaf${i}`,
				label: `Category ${i + 1}`,
				value: count - i,
				colorVar: '--blue',
				column: 1
			}))
		],
		links: Array.from({ length: count }, (_, i) => ({
			from: 'in',
			to: `leaf${i}`,
			value: count - i
		}))
	});

	it('shrinks a crowded column’s type rather than dropping its names', () => {
		const roomy = buildSankey(crowded(13), { width: 900, height: 560 });
		const tight = buildSankey(crowded(13), { width: 900, height: 300 });
		const font = (layout: typeof roomy) => layout.labels.find((l) => l.column === 1)!.font;

		expect(font(tight)).toBeLessThan(font(roomy));
		expect(tight.labels.every((l) => l.fits)).toBe(true);
	});

	// The biggest bands keep their labels; the rest are still on hover and in the breakdown strip.
	it('drops only what a floor-sized label still cannot fit, smallest first', () => {
		const layout = buildSankey(crowded(40), { width: 900, height: 300 });
		const named = layout.labels.filter((l) => l.column === 1 && l.fits);
		const dropped = layout.labels.filter((l) => l.column === 1 && !l.fits);

		expect(named.length).toBeGreaterThan(10);
		expect(dropped.length).toBeGreaterThan(0);
		expect(Math.max(...dropped.map((l) => l.value))).toBeLessThan(
			Math.min(...named.map((l) => l.value))
		);
	});

	it('stacks a node’s incoming bands by where they came from', () => {
		// Bands must arrive in the order the sources sit in, or they cross inside the target.
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
