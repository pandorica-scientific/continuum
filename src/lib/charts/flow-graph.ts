// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The only file that knows a salary from a mortgage.
//
// Turns the cash-flow figures into the plain graph the Sankey engine draws, so
// adding a level, splitting a group or introducing a node kind that does not
// exist yet is a change here and nowhere else. The engine stays geometry.

import type { SankeyGraph } from './sankey';

/** The figures the chart is built from, as the cash-flow loader returns them. */
export interface FlowFigures {
	sources: { name: string; amount: number }[];
	stages: { key: string; label: string; colorVar: string; amount: number }[];
	remainderLabel: string;
}

export interface FlowGraphInput extends FlowFigures {
	kept: number;
	breakdown: { key: string; leaves: { name: string; value: number }[] }[];
}

/** Below this the leaf column is dropped; below the second, groups only. */
const LEAF_WIDTH = 560;
const GROUP_WIDTH = 380;

/** How many columns the box has room for. */
export function depthFor(width: number): 2 | 3 | 4 {
	if (width < GROUP_WIDTH) return 2;
	if (width < LEAF_WIDTH) return 3;
	return 4;
}

const INCOME = '--green';

/**
 * Build the graph: sources → Income → groups → leaves.
 *
 * `depth` drops columns from the right rather than letting the engine draw
 * something illegible in a narrow box. Nothing is lost when it does — the
 * leaves stay in the breakdown strip beneath the chart.
 */
export function flowGraph(input: FlowGraphInput, depth: 2 | 3 | 4 = 4): SankeyGraph {
	const graph: SankeyGraph = { nodes: [], links: [] };

	const sources = input.sources.filter((s) => s.amount > 0);
	const total = sources.reduce((sum, s) => sum + s.amount, 0);

	// Two columns means no separate income node: sources feed the groups.
	const incomeColumn = depth === 2 ? -1 : 1;
	const groupColumn = depth === 2 ? 1 : 2;

	sources.forEach((source, i) => {
		graph.nodes.push({
			key: `src:${i}`,
			label: source.name,
			value: source.amount,
			colorVar: INCOME,
			column: 0
		});
	});

	if (incomeColumn >= 0) {
		graph.nodes.push({
			key: 'income',
			label: 'Income',
			value: total,
			colorVar: INCOME,
			column: incomeColumn
		});
		sources.forEach((source, i) => {
			graph.links.push({ from: `src:${i}`, to: 'income', value: source.amount });
		});
	}

	// Every group, plus what survived them, so the column conserves the total.
	const outflows = [
		...input.stages
			.filter((stage) => stage.amount > 0)
			.map((stage) => ({
				key: stage.key,
				label: stage.label,
				value: stage.amount,
				colorVar: stage.colorVar
			})),
		...(input.kept > 0
			? [{ key: 'kept', label: input.remainderLabel, value: input.kept, colorVar: '--teal' }]
			: [])
	];

	for (const outflow of outflows) {
		graph.nodes.push({
			key: `grp:${outflow.key}`,
			label: outflow.label,
			value: outflow.value,
			colorVar: outflow.colorVar,
			column: groupColumn
		});
		if (incomeColumn >= 0) {
			graph.links.push({ from: 'income', to: `grp:${outflow.key}`, value: outflow.value });
		} else {
			// Without an income node the sources feed groups directly, split in
			// proportion so every source's whole value leaves it.
			for (const [i, source] of sources.entries()) {
				const share = total > 0 ? (source.amount / total) * outflow.value : 0;
				if (share > 0)
					graph.links.push({ from: `src:${i}`, to: `grp:${outflow.key}`, value: share });
			}
		}
	}

	if (depth < 4) return graph;

	const leavesFor = new Map(input.breakdown.map((b) => [b.key, b.leaves]));
	for (const outflow of outflows) {
		// A group with nothing broken out simply has no leaves. It still draws;
		// its column is lighter, which the engine allows.
		for (const [i, leaf] of (leavesFor.get(outflow.key) ?? [])
			.filter((l) => l.value > 0)
			.entries()) {
			const key = `leaf:${outflow.key}:${i}`;
			graph.nodes.push({
				key,
				label: leaf.name,
				value: leaf.value,
				colorVar: outflow.colorVar,
				column: 3
			});
			graph.links.push({ from: `grp:${outflow.key}`, to: key, value: leaf.value });
		}
	}

	return graph;
}
