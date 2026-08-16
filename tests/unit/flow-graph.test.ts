import { describe, expect, it } from 'vitest';
import { depthFor, flowGraph, type FlowGraphInput } from '$lib/charts/flow-graph';

const flow: FlowGraphInput = {
	sources: [
		{ name: 'Salary', amount: 372_000 },
		{ name: 'Rent received', amount: 99_000 },
		// Dividends ships as an income category and appears as soon as it earns.
		{ name: 'Dividends', amount: 0 }
	],
	stages: [
		{ key: 'housing', label: 'Housing', colorVar: '--blue', amount: 355_836 },
		{ key: 'living', label: 'Food & lifestyle', colorVar: '--purple', amount: 74_289 },
		{ key: 'transport', label: 'Transport', colorVar: '--yellow', amount: 0 }
	],
	remainderLabel: 'Saved & invested',
	kept: 40_875,
	breakdown: [
		{
			key: 'housing',
			leaves: [
				{ name: 'Mortgage · home', value: 326_736 },
				{ name: 'SVJ & insurance', value: 29_100 }
			]
		},
		{ key: 'living', leaves: [] }
	]
};

const column = (graph: ReturnType<typeof flowGraph>, c: number) =>
	graph.nodes.filter((n) => n.column === c);
const sum = (nodes: { value: number }[]) => nodes.reduce((s, n) => s + n.value, 0);

describe('flowGraph', () => {
	it('carries the income total through to the outflow column', () => {
		const graph = flowGraph(flow);
		expect(sum(column(graph, 0))).toBe(471_000);
		expect(sum(column(graph, 1))).toBe(471_000);
		// Groups plus what survived them: nothing is dropped on the way across.
		expect(sum(column(graph, 2))).toBe(471_000);
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

	it('keeps what survived as its own outflow', () => {
		expect(column(flowGraph(flow), 2).map((n) => n.label)).toContain('Saved & invested');
	});

	// The engine allows a lighter final column; the adapter must not invent
	// filler to pad it.
	it('draws a group with no leaves broken out, and gives it none', () => {
		const graph = flowGraph(flow);
		expect(column(graph, 2).map((n) => n.label)).toContain('Food & lifestyle');
		expect(graph.links.filter((l) => l.from === 'grp:living')).toHaveLength(0);
	});

	it('hangs each leaf off its own group', () => {
		const graph = flowGraph(flow);
		const leaves = graph.links.filter((l) => l.from === 'grp:housing');
		expect(sum(leaves.map((l) => ({ value: l.value })))).toBe(355_836);
	});

	it('gives a leaf its group colour, so a ribbon reads as one flow', () => {
		const graph = flowGraph(flow);
		for (const leaf of column(graph, 3)) expect(leaf.colorVar).toBe('--blue');
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
			const fromSalary = graph.links.filter((l) => l.from === 'src:0');
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
