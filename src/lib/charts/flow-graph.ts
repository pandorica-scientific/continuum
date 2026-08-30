// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The only file that knows a salary from a mortgage.
//
// Turns the cash-flow figures into the plain graph the Sankey engine draws, so
// adding a level, splitting a group or introducing a node kind that does not
// exist yet is a change here and nowhere else. The engine stays geometry.

import type { SankeyGraph } from './sankey';

/** The figures the chart is built from, as the cash-flow loader returns them. */
export interface FlowFigures {
	/**
	 * Everything entering on the left. `colorVar` is the green of income unless
	 * a source says otherwise — a period that took money back OUT of a savings
	 * group enters here wearing that group's own colour, because it is a
	 * drawdown and not something the household earned.
	 */
	sources: {
		key: string;
		name: string;
		amount: number;
		colorVar?: string;
		/** The rows behind this figure, in the register. Null where there are none. */
		href?: string | null;
	}[];
	/**
	 * Every group the money passes through, savings included: putting money in a
	 * brokerage account empties the current account exactly as rent does, and a
	 * stage is what left. `role` is what tells the two apart afterwards.
	 */
	stages: {
		key: string;
		label: string;
		colorVar: string;
		amount: number;
		role: 'expense' | 'savings';
		/** The register, narrowed to this group. */
		href?: string | null;
	}[];
	/** What the surplus is called when the stages left something behind. */
	keptLabel: string;
	/** And what the shortfall is called when they did not. */
	reservesLabel: string;
	/**
	 * Where the trunk leads: everything that came in over the period.
	 *
	 * Supplied here rather than built below, alongside the two labels, because
	 * the trunk is a node this file invents and only the loader knows which
	 * period the figures are from.
	 */
	incomeHref?: string | null;
}

export interface FlowGraphInput extends FlowFigures {
	kept: number;
	breakdown: {
		key: string;
		leaves: { name: string; value: number; href?: string | null }[];
	}[];
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

/** Spending money the household already had is a state, and states are red. */
export const RESERVES_COLOR = '--red';

/**
 * Half a minor unit, below which a figure is dust rather than a number.
 *
 * The residual is tested against this rather than against zero: a break-even
 * month accumulates float error through a dozen conversions, and drawing a red
 * "From reserves" for a shortfall of a hundredth of a crown reports a rounding
 * artefact as bad news — which is the policy `tone.ts` already states.
 */
export const ROUNDING = 0.005;

/**
 * The colour of cash that simply stayed cash.
 *
 * Indigo rather than the savings group's own token: this is a quantity and not
 * a verdict, and it now stands in the same column as the savings stage, which
 * it must not be mistaken for.
 */
export const KEPT_COLOR = '--indigo';

/**
 * What the two ends of the residual are keyed by — in the breakdown strip, in
 * the figures a window is compared against, and on the graph alike.
 *
 * Namespaced, and that is the whole point of the prefix. Every other key in the
 * column beside it is a category group's, and a group's key is the household's
 * own words: `createCategoryGroup` derives it with `taxonomyKey(label)`, so a
 * group somebody called "Kept" is keyed `kept`. A bare residual key would then
 * sit in the breakdown twice under one name, which the keyed `{#each}` drawing
 * the strip throws on — in production as well as in development, taking the
 * screen down. `taxonomyKey` keeps only letters, digits and hyphens, so a colon
 * is a character a household's key can never hold and the prefix cannot be
 * collided with by anything anyone types.
 */
export const KEPT_KEY = 'residual:kept';
export const RESERVES_KEY = 'residual:reserves';

/**
 * Build the graph: sources → Income → groups → leaves.
 *
 * `depth` drops columns from the right rather than letting the engine draw
 * something illegible in a narrow box. Nothing is lost when it does — the
 * leaves stay in the breakdown strip beneath the chart.
 */
export function flowGraph(input: FlowGraphInput, depth: 2 | 3 | 4 = 4): SankeyGraph {
	const graph: SankeyGraph = { nodes: [], links: [] };

	// A month that spent more than it earned took the difference from money it
	// already had, so that difference enters as a source of its own. Without it
	// the outflow column would be taller than the income column, and the engine
	// would be asked to draw a total nothing paid for.
	const drawnFromReserves = input.kept < -ROUNDING;
	const sources = [
		...input.sources
			.filter((source) => source.amount > 0)
			.map((source) => ({ ...source, colorVar: source.colorVar ?? INCOME })),
		...(drawnFromReserves
			? [
					{
						key: RESERVES_KEY,
						name: input.reservesLabel,
						amount: -input.kept,
						colorVar: RESERVES_COLOR,
						// Money the household already had is not a set of rows: it is
						// what the period could not pay for out of what it earned.
						href: null
					}
				]
			: [])
	];
	const total = sources.reduce((sum, source) => sum + source.amount, 0);

	// Two columns means no separate income node: sources feed the groups.
	const incomeColumn = depth === 2 ? -1 : 1;
	const groupColumn = depth === 2 ? 1 : 2;

	for (const source of sources) {
		graph.nodes.push({
			key: `src:${source.key}`,
			label: source.name,
			value: source.amount,
			colorVar: source.colorVar,
			column: 0,
			showValue: true,
			href: source.href ?? null
		});
	}

	if (incomeColumn >= 0) {
		graph.nodes.push({
			key: 'income',
			// The trunk carries the reserves too, so on a shortfall it must not
			// stand there labelled "Income" holding more than the household earned.
			label: drawnFromReserves ? 'Income + reserves' : 'Income',
			value: total,
			colorVar: INCOME,
			column: incomeColumn,
			showValue: true,
			href: input.incomeHref ?? null
		});
		for (const source of sources) {
			graph.links.push({ from: `src:${source.key}`, to: 'income', value: source.amount });
		}
	}

	// Every group — savings among them — plus the cash none of them took, so the
	// column conserves the total.
	const outflows = [
		...input.stages
			.filter((stage) => stage.amount > 0)
			.map((stage) => ({
				key: stage.key,
				label: stage.label,
				value: stage.amount,
				colorVar: stage.colorVar,
				href: stage.href ?? null
			})),
		...(input.kept > ROUNDING
			? [
					{
						key: KEPT_KEY,
						label: input.keptLabel,
						value: input.kept,
						colorVar: KEPT_COLOR,
						// Cash that stayed cash is a residual, not a set of rows.
						href: null
					}
				]
			: [])
	];

	for (const outflow of outflows) {
		graph.nodes.push({
			key: `grp:${outflow.key}`,
			label: outflow.label,
			value: outflow.value,
			colorVar: outflow.colorVar,
			column: groupColumn,
			href: outflow.href
		});
		if (incomeColumn >= 0) {
			graph.links.push({ from: 'income', to: `grp:${outflow.key}`, value: outflow.value });
		} else {
			// Without an income node the sources feed groups directly, split in
			// proportion so every source's whole value leaves it.
			for (const source of sources) {
				const share = total > 0 ? (source.amount / total) * outflow.value : 0;
				if (share > 0)
					graph.links.push({ from: `src:${source.key}`, to: `grp:${outflow.key}`, value: share });
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
				column: 3,
				href: leaf.href ?? null
			});
			graph.links.push({ from: `grp:${outflow.key}`, to: key, value: leaf.value });
		}
	}

	return graph;
}
