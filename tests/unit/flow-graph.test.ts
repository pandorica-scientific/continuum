import { describe, expect, it } from 'vitest';
import { depthFor, flowGraph, KEPT_COLOR, type FlowGraphInput } from '$lib/charts/flow-graph';

const flow: FlowGraphInput = {
	sources: [
		{ key: 'cat:salary', name: 'Salary', amount: 372_000 },
		{ key: 'cat:rent-received', name: 'Rent received', amount: 99_000 },
		// Dividends ships as an income category and appears as soon as it earns.
		{ key: 'cat:dividends', name: 'Dividends', amount: 0 }
	],
	stages: [
		{ key: 'housing', label: 'Housing', colorVar: '--blue', amount: 355_836, role: 'expense' },
		{
			key: 'living',
			label: 'Food & lifestyle',
			colorVar: '--purple',
			amount: 74_289,
			role: 'expense'
		},
		{ key: 'transport', label: 'Transport', colorVar: '--yellow', amount: 0, role: 'expense' },
		// Money put aside left the account like everything else in this column.
		{
			key: 'savings',
			label: 'Saved & invested',
			colorVar: '--teal',
			amount: 25_000,
			role: 'savings'
		}
	],
	keptLabel: 'Kept in cash',
	reservesLabel: 'From reserves',
	kept: 15_875,
	breakdown: [
		{
			key: 'housing',
			leaves: [
				{ name: 'Mortgage · home', value: 326_736 },
				{ name: 'SVJ & insurance', value: 29_100 }
			]
		},
		{ key: 'living', leaves: [] },
		{
			key: 'savings',
			leaves: [
				{ name: 'Brokerage', value: 20_000 },
				{ name: 'Pension', value: 5_000 }
			]
		}
	]
};

/**
 * The same household in a month it could not pay for out of what it earned.
 *
 * Income 471 000 against 496 000 of stages: the 25 000 difference came from
 * money it already had.
 */
const shortfall: FlowGraphInput = {
	...flow,
	stages: [
		{ key: 'housing', label: 'Housing', colorVar: '--blue', amount: 470_000, role: 'expense' },
		{
			key: 'savings',
			label: 'Saved & invested',
			colorVar: '--teal',
			amount: 26_000,
			role: 'savings'
		}
	],
	kept: -25_000,
	breakdown: []
};

/**
 * A household that keeps two places to put money aside.
 *
 * Income 471 000, one expense stage of 356 000 and two savings stages worth
 * 55 000 between them, so 60 000 is left as cash.
 */
const twoSavings: FlowGraphInput = {
	...flow,
	stages: [
		{ key: 'housing', label: 'Housing', colorVar: '--blue', amount: 356_000, role: 'expense' },
		{
			key: 'savings',
			label: 'Saved & invested',
			colorVar: '--teal',
			amount: 25_000,
			role: 'savings'
		},
		{ key: 'pension', label: 'Pension', colorVar: '--purple', amount: 30_000, role: 'savings' }
	],
	kept: 60_000,
	breakdown: [
		{ key: 'savings', leaves: [{ name: 'Brokerage', value: 25_000 }] },
		{ key: 'pension', leaves: [{ name: 'Employer plan', value: 30_000 }] }
	]
};

/**
 * A period that took money back OUT of savings.
 *
 * The loader hands the drawdown over as a source rather than as a stage worth
 * minus something, so the adapter has nothing special to do with it — except
 * leave it the colour it arrived in, because it is not income.
 */
const drawdown: FlowGraphInput = {
	...flow,
	sources: [
		{ key: 'cat:salary', name: 'Salary', amount: 372_000 },
		{ key: 'grp:savings', name: 'Saved & invested', amount: 10_000, colorVar: '--teal' }
	],
	stages: [
		{ key: 'housing', label: 'Housing', colorVar: '--blue', amount: 356_000, role: 'expense' }
	],
	kept: 26_000,
	breakdown: []
};

/**
 * The same household with the links the loader hangs on its figures.
 *
 * The adapter builds none of them and must not: only the loader knows which
 * period the figures came from. What it has to do is carry every one through to
 * the node a reader can actually click — and leave the nodes it invents for
 * itself with nowhere to go, because "kept in cash" and "from reserves" are
 * residuals rather than anything the register holds rows for.
 */
const linked: FlowGraphInput = {
	...flow,
	incomeHref: '/transactions?dir=in&from=2026-03-01&to=2026-03-31&month=2026-03',
	sources: [
		{ key: 'cat:salary', name: 'Salary', amount: 372_000, href: '/transactions?category=salary' },
		{
			key: 'unfiled:in',
			name: 'Unfiled income',
			amount: 9_000,
			href: '/transactions?category=none&dir=in'
		}
	],
	stages: [
		{
			key: 'housing',
			label: 'Housing',
			colorVar: '--blue',
			amount: 355_836,
			role: 'expense',
			href: '/transactions?group=housing'
		}
	],
	kept: 25_164,
	breakdown: [
		{
			key: 'housing',
			leaves: [
				{ name: 'Mortgage · home', value: 326_736, href: '/transactions?category=mortgage' },
				{ name: 'SVJ & insurance', value: 29_100, href: '/transactions?category=svj' }
			]
		}
	]
};

const column = (graph: ReturnType<typeof flowGraph>, c: number) =>
	graph.nodes.filter((n) => n.column === c);
const sum = (nodes: { value: number }[]) => nodes.reduce((s, n) => s + n.value, 0);
const linksFrom = (graph: ReturnType<typeof flowGraph>, key: string) =>
	graph.links.filter((l) => l.from === key);

describe('flowGraph', () => {
	it('carries the income total through to the outflow column', () => {
		const graph = flowGraph(flow);
		expect(sum(column(graph, 0))).toBe(471_000);
		expect(sum(column(graph, 1))).toBe(471_000);
		// Groups plus what survived them: nothing is dropped on the way across.
		expect(sum(column(graph, 2))).toBe(471_000);
		expect(column(graph, 1)[0].label).toBe('Income');
	});

	// An income category with no transactions must not draw a zero-height node.
	it('leaves out a source that earned nothing', () => {
		const labels = column(flowGraph(flow), 0).map((n) => n.label);
		expect(labels).toEqual(['Salary', 'Rent received']);
	});

	it('leaves out a group that spent nothing', () => {
		const labels = column(flowGraph(flow), 2).map((n) => n.label);
		expect(labels).not.toContain('Transport');
	});

	// The defect this replaced: the remainder node was keyed `kept` and coloured
	// as savings, while the savings leaves were keyed by the savings group. They
	// hung off a node that did not exist, so they never drew at all.
	it('hangs the savings leaves off the savings stage', () => {
		const graph = flowGraph(flow);
		const leaves = linksFrom(graph, 'grp:savings');
		expect(leaves.map((l) => l.value)).toEqual([20_000, 5_000]);
		expect(sum(leaves.map((l) => ({ value: l.value })))).toBe(25_000);
		expect(column(graph, 3).map((n) => n.label)).toContain('Brokerage');
	});

	it('keeps what neither the stages nor savings took as cash, in its own colour', () => {
		const kept = column(flowGraph(flow), 2).find((n) => n.key === 'grp:residual:kept');
		expect(kept).toMatchObject({ label: 'Kept in cash', value: 15_875, colorVar: KEPT_COLOR });
		expect(KEPT_COLOR).toBe('--indigo');
	});

	// The engine allows a lighter final column; the adapter must not invent
	// filler to pad it.
	it('draws a group with no leaves broken out, and gives it none', () => {
		const graph = flowGraph(flow);
		expect(column(graph, 2).map((n) => n.label)).toContain('Food & lifestyle');
		expect(linksFrom(graph, 'grp:living')).toHaveLength(0);
	});

	it('hangs each leaf off its own group', () => {
		const graph = flowGraph(flow);
		const leaves = linksFrom(graph, 'grp:housing');
		expect(sum(leaves.map((l) => ({ value: l.value })))).toBe(355_836);
	});

	it('gives a leaf its group colour, so a ribbon reads as one flow', () => {
		const graph = flowGraph(flow);
		const colourOf = (label: string) => column(graph, 3).find((n) => n.label === label)?.colorVar;
		expect(colourOf('Mortgage · home')).toBe('--blue');
		expect(colourOf('Brokerage')).toBe('--teal');
	});

	describe('a month that spent more than it earned', () => {
		it('draws the difference as a source of its own', () => {
			const reserves = column(flowGraph(shortfall), 0).find(
				(n) => n.key === 'src:residual:reserves'
			);
			expect(reserves).toMatchObject({
				label: 'From reserves',
				value: 25_000,
				colorVar: '--red',
				showValue: true
			});
		});

		it('has nothing left to keep', () => {
			const graph = flowGraph(shortfall);
			expect(graph.nodes.map((n) => n.key)).not.toContain('grp:residual:kept');
			expect(graph.nodes.map((n) => n.label)).not.toContain('Kept in cash');
		});

		it('conserves every column, reserves included', () => {
			const graph = flowGraph(shortfall);
			expect(sum(column(graph, 0))).toBe(496_000);
			expect(sum(column(graph, 1))).toBe(496_000);
			expect(sum(column(graph, 2))).toBe(496_000);
		});

		// The trunk holds income plus the drawdown, so a fixture reading
		// "Income 496 000" under a tile reading "In 471 000" was the chart
		// contradicting the totals row above it.
		it('says on the trunk that it is no longer only income', () => {
			const trunk = column(flowGraph(shortfall), 1)[0];
			expect(trunk).toMatchObject({
				key: 'income',
				label: 'Income + reserves',
				value: 496_000
			});
		});

		it('conserves the narrow depths too', () => {
			for (const depth of [2, 3] as const) {
				const graph = flowGraph(shortfall, depth);
				expect(sum(column(graph, 0))).toBe(496_000);
				expect(sum(column(graph, depth === 2 ? 1 : 2))).toBe(496_000);
			}
			// Without an income node the reserves feed the groups directly, and
			// the whole of what was drawn has to leave the node that drew it.
			const flat = flowGraph(shortfall, 2);
			expect(linksFrom(flat, 'src:residual:reserves').reduce((s, l) => s + l.value, 0)).toBeCloseTo(
				25_000,
				6
			);
		});
	});

	// Nothing about a savings stage is special to the adapter: a household with a
	// brokerage and a pension gets two of them, drawn exactly as a group is.
	describe('more than one savings group', () => {
		it('draws every savings stage, each with its own leaves', () => {
			const graph = flowGraph(twoSavings);
			const outflows = column(graph, 2).map((n) => ({ key: n.key, value: n.value }));
			expect(outflows).toEqual([
				{ key: 'grp:housing', value: 356_000 },
				{ key: 'grp:savings', value: 25_000 },
				{ key: 'grp:pension', value: 30_000 },
				{ key: 'grp:residual:kept', value: 60_000 }
			]);
			expect(sum(linksFrom(graph, 'grp:savings').map((l) => ({ value: l.value })))).toBe(25_000);
			expect(sum(linksFrom(graph, 'grp:pension').map((l) => ({ value: l.value })))).toBe(30_000);
			expect(column(graph, 3).map((n) => n.label)).toEqual(['Brokerage', 'Employer plan']);
		});

		it('still conserves the column', () => {
			const graph = flowGraph(twoSavings);
			expect(sum(column(graph, 0))).toBe(471_000);
			expect(sum(column(graph, 2))).toBe(471_000);
		});
	});

	// Taking money back out of savings is not saving, and it is not income
	// either. It enters on the left in the group's own colour.
	describe('a savings group the period drew down', () => {
		it('enters as a source of its own, not as a stage', () => {
			const graph = flowGraph(drawdown);
			expect(column(graph, 0).map((n) => n.key)).toEqual(['src:cat:salary', 'src:grp:savings']);
			expect(column(graph, 0)[1]).toMatchObject({
				label: 'Saved & invested',
				value: 10_000,
				colorVar: '--teal',
				showValue: true
			});
			expect(column(graph, 2).map((n) => n.key)).toEqual(['grp:housing', 'grp:residual:kept']);
		});

		it('is counted into the trunk like anything else on the left', () => {
			const graph = flowGraph(drawdown);
			expect(sum(column(graph, 0))).toBe(382_000);
			expect(sum(column(graph, 1))).toBe(382_000);
			expect(sum(column(graph, 2))).toBe(382_000);
		});
	});

	// Float dust is not a shortfall. A break-even month accumulates rounding
	// error through a dozen conversions, and `tone.ts` states the policy: at
	// exactly nothing kept there is nothing to report either way.
	describe('a residual of dust', () => {
		it('draws neither cash kept nor reserves', () => {
			for (const kept of [0.004, -0.004]) {
				const keys = flowGraph({ ...drawdown, kept }).nodes.map((n) => n.key);
				expect(keys).not.toContain('grp:residual:kept');
				expect(keys).not.toContain('src:residual:reserves');
			}
		});
	});

	// The chart is the household's index into its own ledger: every band on it
	// stands for rows the register can list. The adapter is the only thing
	// between the loader that knows the period and the renderer that draws the
	// anchor, so a link dropped here is a band that reads as clickable and is not.
	describe('links through to the register', () => {
		const nodeFor = (graph: ReturnType<typeof flowGraph>, key: string) =>
			graph.nodes.find((n) => n.key === key);

		it('carries a source, a stage and a leaf through to their nodes', () => {
			const graph = flowGraph(linked);
			expect(nodeFor(graph, 'src:cat:salary')?.href).toBe('/transactions?category=salary');
			expect(nodeFor(graph, 'src:unfiled:in')?.href).toBe('/transactions?category=none&dir=in');
			expect(nodeFor(graph, 'grp:housing')?.href).toBe('/transactions?group=housing');
			expect(nodeFor(graph, 'leaf:housing:0')?.href).toBe('/transactions?category=mortgage');
			expect(nodeFor(graph, 'leaf:housing:1')?.href).toBe('/transactions?category=svj');
		});

		it('gives the trunk the link the loader built for it', () => {
			expect(nodeFor(flowGraph(linked), 'income')?.href).toBe(
				'/transactions?dir=in&from=2026-03-01&to=2026-03-31&month=2026-03'
			);
		});

		// Cash that stayed cash is not a set of transactions, and neither is the
		// difference a month could not pay for. Both are arithmetic on the rest.
		it('leaves the residual nodes with nowhere to go', () => {
			expect(nodeFor(flowGraph(linked), 'grp:residual:kept')?.href).toBeNull();
			expect(nodeFor(flowGraph(shortfall), 'src:residual:reserves')?.href).toBeNull();
		});

		it('says null rather than nothing when the loader gave it no links', () => {
			for (const node of flowGraph(flow).nodes) expect(node.href).toBeNull();
		});
	});

	describe('narrow boxes', () => {
		it('drops the leaf column but keeps every value', () => {
			const graph = flowGraph(flow, 3);
			expect(column(graph, 3)).toHaveLength(0);
			expect(sum(column(graph, 2))).toBe(471_000);
		});

		it('drops to sources and groups, still conserving the total', () => {
			const graph = flowGraph(flow, 2);
			expect(sum(column(graph, 0))).toBe(471_000);
			expect(sum(column(graph, 1))).toBe(471_000);
			// Every source's whole value has to leave it, split across the groups.
			const fromSalary = linksFrom(graph, 'src:cat:salary');
			expect(fromSalary.reduce((s, l) => s + l.value, 0)).toBeCloseTo(372_000, 6);
		});
	});
});

describe('depthFor', () => {
	it('gives a wide box every column', () => {
		expect(depthFor(1240)).toBe(4);
	});

	it('drops the leaves before they become unreadable', () => {
		expect(depthFor(559)).toBe(3);
	});

	it('drops to two columns on a phone', () => {
		expect(depthFor(360)).toBe(2);
	});
});
