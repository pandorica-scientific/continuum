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
	/**
	 * Whether the label carries the amount under the name.
	 *
	 * Set by whoever builds the graph, because it is a question about meaning
	 * rather than geometry: on the cash-flow chart the income side is read as
	 * figures and the spending side as names, since every spending figure is
	 * already in the breakdown strip under the diagram.
	 */
	showValue?: boolean;
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
	/**
	 * Whether this name is drawn at all.
	 *
	 * A column shrinks its type to fit every one of its names before it drops
	 * any (see planColumn). Only when a column still cannot fit them at the
	 * smallest readable size do the smallest bands lose their label — and they
	 * are still on hover and in the breakdown strip.
	 */
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
/**
 * The gap between an outer column's blocks and its names.
 *
 * It is there so a leader line has something to slope along. A band thinner than
 * its own name cannot keep that name level with itself once its neighbours want
 * the same rows, and a name pushed off its band with nothing joining the two
 * names nothing at all.
 */
const LEADER = 22;

const labelHeight = (font: number, withValue: boolean) =>
	Math.ceil(font * LINE) + (withValue ? Math.ceil(font * VALUE_RATIO * LINE) + 1 : 0) + PAD_Y * 2;

/**
 * Estimated width of a run of text.
 *
 * The engine has no DOM to measure in. 0.62em per character is the measured
 * average for the UI face across the names this draws, rounded up rather than
 * to the mean: the renderer ellipsises anything that beats the estimate, and a
 * narrow-viewport guard treats an ellipsis as clipped text, which is what an
 * under-estimate cost the first time.
 */
const textWidth = (chars: number, font: number) => chars * font * 0.62;

/** How many characters a grouped amount with two decimals occupies. */
function valueChars(value: number): number {
	const whole = Math.round(Math.abs(value)).toString();
	return whole.length + Math.floor((whole.length - 1) / 3) + 3;
}

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

/**
 * How far along the run the Bézier control points sit.
 *
 * A third, which is what Highcharts uses. The engine this replaces put both at
 * the midpoint — the steepest middle a cubic can have, and the reason a dozen
 * parallel bands smeared into each other. A third holds each band flat as it
 * leaves its block and turns once, so neighbours stay distinguishable.
 */
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
 * names fits the height, down to a readable floor.
 *
 * Per column rather than per chart, because the columns are not alike — four
 * income sources and twenty-five leaves want different sizes, and sizing the
 * whole chart for its most crowded column would shrink the names that had room.
 */
function planColumn(nodes: SankeyNodeInput[], boxHeight: number): ColumnPlan {
	const withValue = nodes.some((n) => n.showValue);
	let font = MAX_FONT;
	while (font > MIN_FONT && nodes.length * (labelHeight(font, withValue) + 1) > boxHeight) font--;
	const height = labelHeight(font, withValue);
	const lane =
		Math.max(
			0,
			...nodes.map((n) =>
				Math.max(
					textWidth(n.label.length, font),
					n.showValue ? textWidth(valueChars(n.value), font * VALUE_RATIO) : 0
				)
			)
		) +
		PAD_X * 2;
	return { font, height, lane, room: Math.floor(boxHeight / (height + 1)), withValue };
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

	// Margins, and where a name can go without lying on the flow.
	//
	// At a node's right edge its outgoing ribbons cover its height exactly — they
	// sum to its value — so on a MIDDLE column there is no free space beside a
	// band at all: not to its right, where its own ribbons leave, and not to its
	// left, where its parents' arrive. Only two places on the whole diagram carry
	// no ribbons: outside the first column, and outside the last.
	//
	// Holding the ribbons back to open a channel for the middle names did work,
	// and it cost more than it bought: every band then started in mid-air, a
	// hand's width clear of the block it came out of. So the ribbons are flush
	// again. The outer columns write into their margins, and the middle ones
	// write over their own flow on a plate — which is what the printed diagrams
	// this is modelled on do too.
	const plans = new Map<number, ColumnPlan>();
	for (const column of columns) {
		plans.set(
			column,
			planColumn(
				graph.nodes.filter((n) => n.column === column),
				box.height
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

	// A middle column writes inside the run its own ribbons occupy, so what bounds
	// its names is the run rather than a margin. Half of it was the first guess and
	// cut "Food & lifestyle" in half on a tablet; they get all of it bar a gap
	// before the next column's blocks, and shrink their type if even that is short.
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
			const shaped: SankeyNode = { ...node, x: xOf.get(column) ?? 0, y, w: NODE_W, h };
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
				fits: named.has(node.key),
				// Only a middle column writes over the flow, so only it needs the
				// plate that lifts text off a saturated band.
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
