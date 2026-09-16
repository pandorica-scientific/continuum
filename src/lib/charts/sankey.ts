// SPDX-License-Identifier: AGPL-3.0-or-later
// A multi-column Sankey, laid out in the pixels of the box it is given.
//
// Pure geometry: no DOM, no framework, no knowledge of money. Invariants
// (nothing outside the box, ribbons flush with their nodes, no label
// collisions, columns conserving their total) are enforced by unit tests.

interface SankeyNodeInput {
	key: string;
	label: string;
	value: number;
	/** CSS custom property name of the node's colour. */
	colorVar: string;
	column: number;
	/** Whether the label carries the amount under the name. Set by the graph builder, not the engine. */
	showValue?: boolean;
	/** Where this block leads, or null when it leads nowhere. Passed through, not read, by the engine. */
	href?: string | null;
}

interface SankeyLink {
	from: string;
	to: string;
	value: number;
}

export interface SankeyGraph {
	nodes: SankeyNodeInput[];
	links: SankeyLink[];
}

interface SankeyBox {
	width: number;
	height: number;
}

export interface SankeyNode extends SankeyNodeInput {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SankeyRibbon {
	from: string;
	to: string;
	/** The link's own figure, carried through — thickness can't be read back into an amount. */
	value: number;
	/** Left edge: the far side of the source column's label channel. */
	x0: number;
	y0: number;
	/** Right edge, flush with the target node's left side. */
	x1: number;
	y1: number;
	thickness: number;
	colorVar: string;
	d: string;
}

interface SankeyLabel {
	key: string;
	/** Whether this name is drawn at all — a column shrinks type before it drops names (see planColumn). */
	fits: boolean;
	column: number;
	label: string;
	value: number;
	/** Whether to draw the amount under the name. */
	showValue: boolean;
	x: number;
	/** Top edge; `height` is the space the label occupies. */
	y: number;
	height: number;
	/** Type size for this column, in px. Crowded columns get smaller type. */
	font: number;
	/** The room this label has. Anything longer is ellipsised. */
	width: number;
	anchor: 'start' | 'end';
	/** Whether it is drawn over the flow and needs a plate behind it. */
	plate: boolean;
	/** The band's colour, so a leader line reads as belonging to it. */
	colorVar: string;
	/** Joins a name to its band where the band was too thin to hold it level. */
	leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

interface SankeyLayout {
	width: number;
	height: number;
	nodes: SankeyNode[];
	ribbons: SankeyRibbon[];
	labels: SankeyLabel[];
}

/** Chunky blocks, as in the reference diagrams — not the old 11px hairlines. */
const NODE_W = 14;
/** Space between stacked nodes in a column. */
const NODE_GAP = 10;

/**
 * The type size labels are drawn at, and the floor a crowded column may shrink
 * to before it starts dropping names.
 */
const MAX_FONT = 13;
const MIN_FONT = 9;
/** The amount is drawn smaller than the name it sits under. */
const VALUE_RATIO = 0.85;
const LINE = 1.3;
/** Breathing room around a label, inside the height and channel reserved for it. */
const PAD_X = 6;
const PAD_Y = 3;
/** Ribbons need a run long enough to read as a flow rather than a smear. */
const MIN_RUN = 48;
/** The gap between an outer column's blocks and its names, for a leader line to slope along. */
const LEADER = 22;

const labelHeight = (font: number, withValue: boolean) =>
	Math.ceil(font * LINE) + (withValue ? Math.ceil(font * VALUE_RATIO * LINE) + 1 : 0) + PAD_Y * 2;

/**
 * How wide a run of text will actually be. The engine is pure and has no DOM,
 * so the caller supplies this — the renderer passes a canvas measurer using
 * the actual faces, since browser fallback fonts before a webfont loads vary
 * in width by OS.
 */
export type MeasureText = (text: string, font: number, kind: 'name' | 'value') => number;

/** Fallback for callers with nothing to measure with — tests, and pre-render layout. */
export const estimateText: MeasureText = (text, font) => text.length * font * 0.62;

/** A stand-in for a formatted amount: mono glyphs are all one width, so a run of zeroes measures the same. */
const valueSample = (value: number) => '0'.repeat(valueChars(value));

/** How many characters a grouped amount with two decimals occupies. */
function valueChars(value: number): number {
	const whole = Math.round(Math.abs(value)).toString();
	return whole.length + Math.floor((whole.length - 1) / 3) + 3;
}

/** The wider of the two lines a label holds: its name, and the amount under it. */
function labelWidth(
	label: string,
	value: number,
	showValue: boolean,
	font: number,
	measure: MeasureText
): number {
	return Math.max(
		measure(label, font, 'name'),
		showValue ? measure(valueSample(value), font * VALUE_RATIO, 'value') : 0
	);
}

/**
 * Resolve vertical collisions in one column: walk the sorted positions, and
 * where consecutive entries sit closer than `minGap`, centre that colliding
 * block on its members' mean preferred position, then settle the whole column
 * into the range the box allows.
 *
 * Pool-adjacent-violators, not sweep-until-stable: recomputing block
 * membership from moved positions can let two arrangements swap forever.
 * Merging only reduces the block count, so this terminates.
 */
function relaxLabels(preferred: number[], minGap: number, minY: number, maxY: number): number[] {
	const order = preferred.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
	const blocks: { sum: number; count: number; items: number[] }[] = [];

	for (const { y, i } of order) {
		blocks.push({ sum: y, count: 1, items: [i] });
		// Merge backwards while the new block would overlap the one before it.
		while (blocks.length > 1) {
			const last = blocks[blocks.length - 1];
			const prev = blocks[blocks.length - 2];
			const prevTop = prev.sum / prev.count - ((prev.count - 1) * minGap) / 2;
			const lastTop = last.sum / last.count - ((last.count - 1) * minGap) / 2;
			if (lastTop >= prevTop + prev.count * minGap) break;
			blocks.splice(blocks.length - 2, 2, {
				sum: prev.sum + last.sum,
				count: prev.count + last.count,
				items: [...prev.items, ...last.items]
			});
		}
	}

	// Flatten the blocks into the column top to bottom. The blocks are in y order
	// and so are the members within each one, so this is already the order both
	// settling walks below read in.
	const items: number[] = [];
	const tops: number[] = [];
	for (const block of blocks) {
		const top = block.sum / block.count - ((block.count - 1) * minGap) / 2;
		block.items.forEach((item, k) => {
			items.push(item);
			tops.push(top + k * minGap);
		});
	}
	const out = new Array<number>(preferred.length);

	// Overflow: stack from the top and let it run off the bottom, so the
	// smallest bands' names (already dropped by `room`/`fits`) are the ones
	// lost, not names pushed off the top that did have room.
	if ((items.length - 1) * minGap > maxY - minY) {
		items.forEach((item, k) => {
			out[item] = minY + k * minGap;
		});
		return out;
	}

	// Settle with two ordered walks rather than clamping each block on its own,
	// which could re-collide a block against a neighbour whose clamped position
	// it never saw. Forward walk pushes each position down past the one above;
	// backward walk pushes each up past the one below — neither revisits an
	// entry, so both terminate.
	for (let i = 0; i < tops.length; i++) {
		tops[i] = Math.max(tops[i], i === 0 ? minY : tops[i - 1] + minGap);
	}
	for (let i = tops.length - 1; i >= 0; i--) {
		tops[i] = Math.min(tops[i], i === tops.length - 1 ? maxY : tops[i + 1] - minGap);
	}
	items.forEach((item, i) => {
		out[item] = tops[i];
	});
	return out;
}

/** How far along the run the Bézier control points sit — a third holds each band flat leaving its block. */
const CURVE = 0.33;

function ribbonPath(x0: number, y0: number, x1: number, y1: number, thickness: number): string {
	const c0 = x0 + (x1 - x0) * CURVE;
	const c1 = x1 - (x1 - x0) * CURVE;
	return (
		`M${x0},${y0} C${c0},${y0} ${c1},${y1} ${x1},${y1} ` +
		`L${x1},${y1 + thickness} C${c1},${y1 + thickness} ${c0},${y0 + thickness} ${x0},${y0 + thickness} Z`
	);
}

interface ColumnPlan {
	/** Type size every label in this column is drawn at. */
	font: number;
	/** Height one label occupies at that size. */
	height: number;
	/** Width the column's names need, before the box has its say. */
	lane: number;
	/** How many labels the column has room for at that size. */
	room: number;
	withValue: boolean;
}

/**
 * Choose one type size for a column: the largest at which every one of its
 * names fits the height, down to a readable floor. Per column rather than per
 * chart, so a crowded column doesn't shrink names in columns that had room.
 */
function planColumn(nodes: SankeyNodeInput[], boxHeight: number, measure: MeasureText): ColumnPlan {
	const withValue = nodes.some((n) => n.showValue);
	let font = MAX_FONT;
	while (font > MIN_FONT && nodes.length * (labelHeight(font, withValue) + 1) > boxHeight) font--;
	const height = labelHeight(font, withValue);
	const lane =
		Math.max(0, ...nodes.map((n) => labelWidth(n.label, n.value, !!n.showValue, font, measure))) +
		PAD_X * 2;
	return { font, height, lane, room: Math.floor(boxHeight / (height + 1)), withValue };
}

export function buildSankey(
	graph: SankeyGraph,
	box: SankeyBox,
	measure: MeasureText = estimateText
): SankeyLayout {
	const columns = [...new Set(graph.nodes.map((n) => n.column))].sort((a, b) => a - b);
	const layout: SankeyLayout = {
		width: box.width,
		height: box.height,
		nodes: [],
		ribbons: [],
		labels: []
	};
	if (columns.length === 0) return layout;

	// One scale for every column. Each carries the same total, so the tallest
	// column fills the height exactly and the diagram never lies about
	// proportion between columns.
	const columnTotal = Math.max(
		...columns.map((c) =>
			graph.nodes.filter((n) => n.column === c).reduce((sum, n) => sum + n.value, 0)
		)
	);
	const mostNodes = Math.max(
		...columns.map((c) => graph.nodes.filter((n) => n.column === c).length)
	);
	const usable = Math.max(1, box.height - (mostNodes - 1) * NODE_GAP);
	// A graph of zeroes would divide by zero and draw NaN; give it a flat scale.
	const scale = columnTotal > 0 ? usable / columnTotal : 0;

	// Margins, and where a name can go without lying on the flow.
	//
	// A middle column has no free space beside a band — ribbons cover its height
	// on both sides. Only outside the first and last columns is there space with
	// no ribbons. So outer columns write into their margins; middle columns
	// write over their own flow on a plate.
	const plans = new Map<number, ColumnPlan>();
	for (const column of columns) {
		plans.set(
			column,
			planColumn(
				graph.nodes.filter((n) => n.column === column),
				box.height,
				measure
			)
		);
	}

	// Only the outer columns reserve width, because they are the only ones whose
	// names are drawn outside the diagram. The reservation carries a little more
	// than the text needs: LEADER is the run a leader line has to slope along
	// when a band is too thin to hold its own name where it sits.
	const first = columns[0];
	const last = columns[columns.length - 1];
	const outer = (column: number) => column === first || column === last;
	const runs = Math.max(1, columns.length - 1);
	// What the names need, and what the leader lines would like on top of it.
	// They are given up in that order: a leader is an explanation, and explaining
	// a name that has been cut in half is worth less than not cutting it.
	const needs = (column: number) => (outer(column) ? (plans.get(column)?.lane ?? 0) + PAD_X : 0);
	const slope = (column: number) => (outer(column) ? LEADER - PAD_X : 0);
	const both = (of: (column: number) => number) => of(first) + (columns.length > 1 ? of(last) : 0);
	const spare = Math.max(0, box.width - columns.length * NODE_W - runs * MIN_RUN);
	const slopeScale =
		both(slope) > 0 ? Math.max(0, Math.min(1, (spare - both(needs)) / both(slope))) : 0;
	// Only once the leaders have given up everything do the names themselves
	// shrink. Type shrinks by the same factor, so they go on fitting until they
	// hit the floor and have to be cut.
	const squeeze = both(needs) > spare ? Math.max(0, spare / both(needs)) : 1;
	if (squeeze < 1) {
		for (const [column, plan] of plans) {
			const font = Math.max(MIN_FONT, Math.floor(plan.font * squeeze));
			const height = labelHeight(font, plan.withValue);
			plans.set(column, {
				...plan,
				font,
				height,
				lane: plan.lane * squeeze,
				room: Math.floor(box.height / (height + 1))
			});
		}
	}
	/** How far an outer column's names stand off their blocks. */
	const standoff = (column: number) =>
		outer(column) ? PAD_X + Math.round(slope(column) * slopeScale) : PAD_X;
	const margin = (column: number) =>
		outer(column)
			? Math.round(needs(column) * squeeze) + Math.round(slope(column) * slopeScale)
			: 0;

	const run =
		columns.length === 1
			? 0
			: Math.max(
					MIN_RUN,
					(box.width - margin(first) - margin(last) - columns.length * NODE_W) / runs
				);

	// A middle column writes inside the run its own ribbons occupy: it gets
	// nearly all of it (minus a gap before the next column), shrinking type
	// if still short.
	const roomInRun = Math.max(0, run - PAD_X * 3);
	for (const [column, plan] of plans) {
		if (outer(column) || plan.lane <= roomInRun || plan.lane <= 0) continue;
		const ratio = roomInRun / plan.lane;
		const font = Math.max(MIN_FONT, Math.floor(plan.font * ratio));
		const height = labelHeight(font, plan.withValue);
		plans.set(column, {
			...plan,
			font,
			height,
			lane: Math.min(plan.lane * ratio, roomInRun),
			room: Math.floor(box.height / (height + 1))
		});
	}

	const xOf = new Map<number, number>();
	let cursor = margin(first);
	for (const column of columns) {
		xOf.set(column, cursor);
		cursor += NODE_W + (column === last ? 0 : run);
	}

	// Ordering: alternating barycentre sweeps over INDICES, not positions —
	// `placed` isn't filled until the placement loop below, so sweeps must run
	// on each other's output (index order), not on geometry that doesn't exist
	// yet. Seed by value, then alternate parent/child order until it settles.
	// Not guaranteed optimal, but converges quickly and deterministically.
	const placed = new Map<string, SankeyNode>();
	const order = new Map<number, string[]>();
	for (const column of columns) {
		order.set(
			column,
			graph.nodes
				.filter((n) => n.column === column)
				.sort((a, b) => b.value - a.value)
				.map((n) => n.key)
		);
	}

	const indexIn = (column: number, key: string) => order.get(column)?.indexOf(key) ?? -1;

	/**
	 * Reorder one column by the mean index of its neighbours in another.
	 *
	 * A node with no neighbour there keeps its place: it has nothing to say about
	 * crossings, and sweeping it to one end would move it for no reason.
	 */
	function sweep(column: number, neighbour: number, edge: 'parents' | 'children') {
		const keys = order.get(column) ?? [];
		const meanOf = (key: string) => {
			const indices = graph.links
				.filter((link) => (edge === 'parents' ? link.to === key : link.from === key))
				.map((link) => indexIn(neighbour, edge === 'parents' ? link.from : link.to))
				.filter((index) => index >= 0);
			return indices.length ? indices.reduce((sum, i) => sum + i, 0) / indices.length : null;
		};
		const withMeans = keys.map((key, position) => ({ key, position, mean: meanOf(key) }));
		withMeans.sort((a, b) => {
			if (a.mean !== null && b.mean !== null) return a.mean - b.mean || a.position - b.position;
			if (a.mean === null && b.mean === null) return a.position - b.position;
			return a.mean === null ? 1 : -1;
		});
		order.set(
			column,
			withMeans.map((entry) => entry.key)
		);
	}

	// Four passes settles every graph this draws; more changes nothing and the
	// loop is cheap enough not to warrant detecting that.
	for (let pass = 0; pass < 4; pass++) {
		for (let i = 1; i < columns.length; i++) sweep(columns[i], columns[i - 1], 'parents');
		for (let i = columns.length - 2; i >= 0; i--) sweep(columns[i], columns[i + 1], 'children');
	}

	// Now place them, in the order the two sweeps settled on.
	for (const column of columns) {
		const byKey = new Map(graph.nodes.filter((n) => n.column === column).map((n) => [n.key, n]));
		const ordered = (order.get(column) ?? [])
			.map((key) => byKey.get(key))
			.filter((node): node is SankeyNodeInput => !!node);
		const stackHeight =
			ordered.reduce((sum, n) => sum + n.value * scale, 0) + (ordered.length - 1) * NODE_GAP;
		let y = Math.max(0, (box.height - stackHeight) / 2);
		for (const node of ordered) {
			const h = Math.max(1, node.value * scale);
			const shaped: SankeyNode = { ...node, x: xOf.get(column) ?? 0, y, w: NODE_W, h };
			placed.set(node.key, shaped);
			layout.nodes.push(shaped);
			y += h + NODE_GAP;
		}
	}

	// Ribbons leave their source stacked in TARGET order and arrive stacked in
	// SOURCE order, so bands do not cross themselves within a node. Needs two
	// separate passes/cursors — one sorted list for both would stack incoming
	// bands by where they're going rather than where they came from.
	const outCursor = new Map<string, number>();
	const inCursor = new Map<string, number>();
	const columnOf = (key: string) => placed.get(key)?.column ?? 0;
	const y0For = new Map<SankeyLink, number>();
	const y1For = new Map<SankeyLink, number>();

	for (const link of [...graph.links].sort(
		(a, b) =>
			columnOf(a.from) - columnOf(b.from) || (placed.get(a.to)?.y ?? 0) - (placed.get(b.to)?.y ?? 0)
	)) {
		const from = placed.get(link.from);
		if (!from) continue;
		const thickness = Math.max(1, link.value * scale);
		y0For.set(link, from.y + (outCursor.get(from.key) ?? 0));
		outCursor.set(from.key, (outCursor.get(from.key) ?? 0) + thickness);
	}

	for (const link of [...graph.links].sort(
		(a, b) =>
			columnOf(a.from) - columnOf(b.from) ||
			(placed.get(a.from)?.y ?? 0) - (placed.get(b.from)?.y ?? 0)
	)) {
		const to = placed.get(link.to);
		if (!to) continue;
		const thickness = Math.max(1, link.value * scale);
		y1For.set(link, to.y + (inCursor.get(to.key) ?? 0));
		inCursor.set(to.key, (inCursor.get(to.key) ?? 0) + thickness);
	}

	const sortedLinks = [...graph.links].sort(
		(a, b) => columnOf(a.from) - columnOf(b.from) || (y0For.get(a) ?? 0) - (y0For.get(b) ?? 0)
	);
	for (const link of sortedLinks) {
		const from = placed.get(link.from);
		const to = placed.get(link.to);
		if (!from || !to) continue;
		const thickness = Math.max(1, link.value * scale);
		const y0 = y0For.get(link) ?? from.y;
		const y1 = y1For.get(link) ?? to.y;
		const x0 = from.x + from.w;
		const x1 = to.x;
		layout.ribbons.push({
			from: link.from,
			to: link.to,
			value: link.value,
			x0,
			y0,
			x1,
			y1,
			thickness,
			colorVar: from.colorVar,
			d: ribbonPath(x0, y0, x1, y1, thickness)
		});
	}

	// Every label is centred on the band it names, in every column — that is the
	// requirement. What varies is where the column can put it, and what has to
	// happen when a band is too thin to hold its own name.
	for (const column of columns) {
		const inColumn = layout.nodes.filter((n) => n.column === column);
		const plan = plans.get(column);
		if (!plan) continue;
		const { font, height, room } = plan;
		const isFirst = column === first;
		const outside = outer(column);

		const preferred = inColumn.map((n) => n.y + n.h / 2 - height / 2);
		// Centring is what is asked for; relaxing is what makes it possible when
		// two bands are thinner than their own names. Labels keep their order and
		// are pushed apart the least the collision allows — and whatever is pushed
		// gets a leader line, below, so it still reads as belonging to its band.
		const relaxed = relaxLabels(preferred, height + 1, 0, Math.max(0, box.height - height));

		// Shrinking the type is tried first and covers every real household; this
		// only bites on a column with more names than a floor-sized label can
		// stack. The biggest bands keep theirs.
		const named = new Set(
			[...inColumn]
				.sort((a, b) => b.value - a.value)
				.slice(0, room)
				.map((n) => n.key)
		);
		// An outer column has its margin. A middle one has only the run its own
		// ribbons occupy, and takes half of it at most, so a long name can never
		// reach the next column's blocks.
		const width = outside
			? Math.max(0, margin(column) - standoff(column))
			: Math.max(0, Math.min(plan.lane, roomInRun));

		inColumn.forEach((node, i) => {
			const nodeCentre = node.y + node.h / 2;
			const labelCentre = relaxed[i] + height / 2;
			// Where the label sits: outside the diagram for the outer columns, and
			// against its own block for the rest.
			const x = isFirst ? node.x - standoff(column) : node.x + node.w + standoff(column);
			layout.labels.push({
				key: node.key,
				column,
				label: node.label,
				value: node.value,
				showValue: !!node.showValue,
				// Room in the column, AND room on the row. The second is the one a
				// squeeze can take away: type shrinks to a floor and the reservation
				// goes on shrinking past it, so a narrow viewport reaches a point
				// where the box is narrower than the name it was drawn for. A name
				// cut in half is worse than one that is not there — the breakdown
				// strip under the chart lists every band with its figure, and that is
				// what a phone reads anyway.
				fits:
					named.has(node.key) &&
					labelWidth(node.label, node.value, !!node.showValue, font, measure) <= width + 0.5,
				plate: !outside,
				colorVar: node.colorVar,
				x,
				y: relaxed[i],
				height,
				font,
				width,
				anchor: isFirst ? 'end' : 'start',
				// Drawn only where the name had to leave its band. Anything closer
				// than a pixel is level with it and needs no explaining.
				leader:
					Math.abs(labelCentre - nodeCentre) > 1
						? {
								x1: isFirst ? node.x : node.x + node.w,
								y1: nodeCentre,
								x2: x,
								y2: labelCentre
							}
						: null
			});
		});
	}

	return layout;
}

/**
 * Every band on the same path as one block, in both directions — upstream to
 * the sources that feed it, downstream to the leaves it ends in.
 *
 * Two breadth-first walks over the link list rather than a graph structure:
 * at this size the cost is nothing, and avoids a second edge representation
 * to keep in sync with the layout.
 */
export function pathRibbons(ribbons: readonly SankeyRibbon[], key: string | null): Set<number> {
	const lit = new Set<number>();
	if (key === null) return lit;

	// Upstream: anything that ends at a node we have reached.
	const walk = (seeds: string[], stepBack: boolean) => {
		const seen = new Set(seeds);
		let frontier = seeds;
		while (frontier.length > 0) {
			const next: string[] = [];
			for (let i = 0; i < ribbons.length; i++) {
				const ribbon = ribbons[i];
				const near = stepBack ? ribbon.to : ribbon.from;
				const far = stepBack ? ribbon.from : ribbon.to;
				if (!frontier.includes(near)) continue;
				lit.add(i);
				if (!seen.has(far)) {
					seen.add(far);
					next.push(far);
				}
			}
			frontier = next;
		}
	};
	walk([key], true);
	walk([key], false);
	return lit;
}

/**
 * The whole route through a ribbon: everything upstream of where it starts and
 * everything downstream of where it ends, plus the band itself — both ends'
 * paths, unioned.
 */
export function ribbonRoute(ribbons: readonly SankeyRibbon[], index: number | null): Set<number> {
	if (index === null || index < 0 || index >= ribbons.length) return new Set();
	const ribbon = ribbons[index];
	const lit = new Set<number>([index]);
	for (const i of pathRibbons(ribbons, ribbon.from)) lit.add(i);
	for (const i of pathRibbons(ribbons, ribbon.to)) lit.add(i);
	return lit;
}
