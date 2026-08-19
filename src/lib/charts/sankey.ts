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

	// Ordering: by mean parent position where there is one, else by value. Two
	// median sweeps then reduce crossings. Deterministic — the same graph always
	// draws the same picture.
	const placed = new Map<string, SankeyNode>();
	for (const column of columns) {
		const inColumn = graph.nodes.filter((n) => n.column === column);
		const parentY = (key: string) => {
			const parents = graph.links
				.filter((l) => l.to === key)
				.map((l) => placed.get(l.from))
				.filter((p): p is SankeyNode => !!p);
			if (parents.length === 0) return null;
			return parents.reduce((sum, p) => sum + p.y + p.h / 2, 0) / parents.length;
		};
		const ordered = inColumn
			.map((node) => ({ node, key: parentY(node.key) }))
			.sort((a, b) => {
				if (a.key !== null && b.key !== null) return a.key - b.key;
				if (a.key !== null) return -1;
				if (b.key !== null) return 1;
				return b.node.value - a.node.value;
			})
			.map((entry) => entry.node);

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

	// Ribbons leave their source stacked in target order and arrive stacked in
	// source order, so bands do not cross themselves within a node.
	const outCursor = new Map<string, number>();
	const inCursor = new Map<string, number>();
	const columnOf = (key: string) => placed.get(key)?.column ?? 0;
	const sortedLinks = [...graph.links].sort(
		(a, b) =>
			columnOf(a.from) - columnOf(b.from) || (placed.get(a.to)?.y ?? 0) - (placed.get(b.to)?.y ?? 0)
	);
	for (const link of sortedLinks) {
		const from = placed.get(link.from);
		const to = placed.get(link.to);
		if (!from || !to) continue;
		const thickness = Math.max(1, link.value * scale);
		const y0 = from.y + (outCursor.get(from.key) ?? 0);
		const y1 = to.y + (inCursor.get(to.key) ?? 0);
		outCursor.set(from.key, (outCursor.get(from.key) ?? 0) + thickness);
		inCursor.set(to.key, (inCursor.get(to.key) ?? 0) + thickness);
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
		const preferred = inColumn.map((n) => n.y + n.h / 2 - LABEL_H / 2);
		const relaxed = relaxLabels(preferred, LABEL_H, 0, Math.max(0, box.height - LABEL_H));
		inColumn.forEach((node, i) => {
			const first = column === columns[0];
			layout.labels.push({
				key: node.key,
				column,
				label: node.label,
				value: node.value,
				x: first ? node.x - 8 : node.x + node.w + 8,
				y: relaxed[i],
				height: LABEL_H,
				anchor: first ? 'end' : column === last ? 'start' : 'middle'
			});
		});
	}

	return layout;
}
