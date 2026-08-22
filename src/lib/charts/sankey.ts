// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A multi-column Sankey, laid out in the pixels of the box it is given.
//
// The engine knows nothing about money. It takes a graph of nodes carrying a
// column index and links carrying a value, and produces geometry. That is what
// makes a fifth column, a split group, or a node kind that does not exist yet a
// change to whoever builds the graph rather than to the layout maths — and it
// is what lets this be tested on synthetic graphs instead of only on real cash
// flow.
//
// Pure: no DOM, no framework. The invariants (nothing outside the box, ribbons
// flush with their nodes, no label collisions, columns conserving their total)
// are enforced by unit tests across a sweep of widths.

interface SankeyNodeInput {
	key: string;
	label: string;
	value: number;
	/** CSS custom property name of the node's colour. */
	colorVar: string;
	column: number;
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

interface SankeyNode extends SankeyNodeInput {
	x: number;
	y: number;
	w: number;
	h: number;
}

interface SankeyRibbon {
	from: string;
	to: string;
	/** Left edge, flush with the source node's right side. */
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
	/**
	 * Whether the band this names is tall enough to carry a label.
	 *
	 * relaxLabels() spaces labels by LABEL_H and clamps the block into the box,
	 * so when a column has more labels than the box has room for, the tail simply
	 * runs off the bottom of the card — which is what "text shows all and is not
	 * scaled" described. Spacing was never the problem; quantity was.
	 */
	fits: boolean;
	column: number;
	label: string;
	value: number;
	x: number;
	/** Top edge; `height` is the space the two lines occupy. */
	y: number;
	height: number;
	anchor: 'start' | 'end' | 'middle';
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
/** Two lines of label, name over value, plus the plate's padding. */
const LABEL_H = 36;
/**
 * The smallest share of its column a node can be and still be named.
 *
 * Ten percent, which on a household's cash flow is the handful of groups worth
 * reading off the diagram directly. Everything smaller is in the breakdown
 * strip beneath the chart and on hover — it is not hidden, it is just not
 * shouted over the top of the picture.
 */
const LABEL_MIN_SHARE = 0.1;
/** Room reserved outside the first and last columns for their labels. A fixed
 *  96 clipped the longer ones against the card edge, and an 88 floor still cut
 *  "Saved & invested" once the narrow layout dropped to three columns. It
 *  scales with the box above a floor wide enough for the longest label. */
const MIN_GUTTER = 112;
const MAX_GUTTER = 150;
const gutterFor = (width: number) =>
	Math.max(MIN_GUTTER, Math.min(MAX_GUTTER, Math.round(width * 0.14)));

/**
 * Resolve vertical collisions in one column: walk the sorted positions, and
 * where consecutive entries sit closer than `minGap`, centre that colliding
 * block on its members' mean preferred position, then clamp into range.
 *
 * Pool-adjacent-violators, not sweep-until-stable. A block's position is the
 * mean of its members' *preferred* positions, so recomputing block membership
 * from the *moved* positions — as a repeated sweep does — lets two arrangements
 * swap forever and never settle. Merging only ever reduces the block count, so
 * this terminates in at most one merge per entry.
 *
 * Carried over intact from the waterfall engine it replaces; it is the piece
 * that took the most iterations to get right.
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

	const out = new Array<number>(preferred.length);
	for (const block of blocks) {
		let top = block.sum / block.count - ((block.count - 1) * minGap) / 2;
		top = Math.max(minY, Math.min(maxY - (block.count - 1) * minGap, top));
		block.items.forEach((item, k) => {
			out[item] = top + k * minGap;
		});
	}
	return out;
}

function ribbonPath(x0: number, y0: number, x1: number, y1: number, thickness: number): string {
	// Control points at the horizontal midpoint: the shape carried over from the
	// engine this replaces.
	const mid = (x0 + x1) / 2;
	return (
		`M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1} ` +
		`L${x1},${y1 + thickness} C${mid},${y1 + thickness} ${mid},${y0 + thickness} ${x0},${y0 + thickness} Z`
	);
}

export function buildSankey(graph: SankeyGraph, box: SankeyBox): SankeyLayout {
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

	const gutter = gutterFor(box.width);
	const innerLeft = gutter;
	const innerRight = box.width - gutter;
	const span = Math.max(NODE_W, innerRight - innerLeft - NODE_W);
	const columnX = (column: number) =>
		columns.length === 1
			? innerLeft
			: innerLeft + (columns.indexOf(column) / (columns.length - 1)) * span;

	// Ordering: alternating barycentre sweeps over INDICES.
	//
	// This has been wrong twice, in ways worth recording. It first claimed "two
	// median sweeps" and did one forward pass. The pass was then written to order
	// each column by its parents' mean POSITION — reading `placed`, which is not
	// filled until the placement loop below, so it read an empty map, returned
	// null for every node, and silently degraded to "sort by value". The backward
	// sweep was doing all the work, from a seed that ignored the graph.
	//
	// Sweeps therefore run on each other's output, not on geometry that does not
	// exist yet: seed by value, then alternate — order each column by where its
	// parents sit, then by where its children sit — until it settles. Barycentre
	// ordering is not guaranteed optimal, but it converges quickly and is
	// deterministic, so the same graph always draws the same picture.
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
			const shaped: SankeyNode = { ...node, x: columnX(column), y, w: NODE_W, h };
			placed.set(node.key, shaped);
			layout.nodes.push(shaped);
			y += h + NODE_GAP;
		}
	}

	// Ribbons leave their source stacked in TARGET order and arrive stacked in
	// SOURCE order, so bands do not cross themselves within a node.
	//
	// That needs two passes, which is what was missing: the single sorted list
	// below fed both cursors, so a ribbon's arrival offset was assigned in target
	// order too and every node's incoming bands were stacked by where they were
	// going rather than where they came from.
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
			x0,
			y0,
			x1,
			y1,
			thickness,
			colorVar: from.colorVar,
			d: ribbonPath(x0, y0, x1, y1, thickness)
		});
	}

	// Labels sit outside the nodes, name over value: the first column anchors
	// right of its gutter, the last anchors left, the rest sit above their node.
	const last = columns[columns.length - 1];
	for (const column of columns) {
		const inColumn = layout.nodes.filter((n) => n.column === column);
		const first = column === columns[0];
		const isLast = column === last;
		// The outer columns label into their gutters, centred on the band. A MIDDLE
		// column has ribbons on both sides, so its label goes ABOVE the band rather
		// than beside it — a label beside a middle node lands on the diagram, which
		// is what "the text on the right is on the plot" was.
		const preferred = inColumn.map((n) =>
			first || isLast ? n.y + n.h / 2 - LABEL_H / 2 : n.y - LABEL_H - 2
		);
		// Relaxed either way. Skipping this for the middle columns let two adjacent
		// groups' labels sit on top of each other, which the invariant suite caught.
		const relaxed = relaxLabels(preferred, LABEL_H, 0, Math.max(0, box.height - LABEL_H));
		// How many labels this column has room for at all. Decided before
		// relaxation rather than after: relaxing decides WHERE they go, and no
		// arrangement helps once there are more than fit.
		const room = Math.max(1, Math.floor(box.height / LABEL_H));
		const columnTotalHere = inColumn.reduce((sum, n) => sum + n.value, 0);

		inColumn.forEach((node, i) => {
			// A label is worth drawing when the band is a real share of the column.
			// Height alone was the wrong test: on a tall chart a 1% sliver clears
			// the pixel threshold and still names something invisible.
			const share = columnTotalHere > 0 ? node.value / columnTotalHere : 0;
			layout.labels.push({
				key: node.key,
				column,
				label: node.label,
				value: node.value,
				fits: inColumn.length <= room && share >= LABEL_MIN_SHARE,
				// The first column labels to its left and the last to its right, into
				// the gutters reserved for exactly that. A MIDDLE column has ribbons on
				// both sides, so a label beside it lands on the diagram — which is what
				// "text in the right is on the plot" was. It sits above its node
				// instead, in the gap the stacking already leaves.
				x: first ? node.x - 8 : isLast ? node.x + node.w + 8 : node.x + node.w / 2,
				y: relaxed[i],
				height: LABEL_H,
				anchor: first ? 'end' : isLast ? 'start' : 'middle'
			});
		});
	}

	return layout;
}
