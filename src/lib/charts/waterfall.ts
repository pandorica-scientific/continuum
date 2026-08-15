// The "where the money goes" waterfall: income fans into a green trunk that
// narrows left to right as each expense group peels off downward in its own
// colour. Pure geometry — no DOM, no framework — so the layout invariants
// (no label collisions, no clipping, drift ≤ 5px) are enforced by unit tests.

export interface WaterfallInput {
	/** Income sources, in display order. */
	sources: { name: string; amount: number }[];
	/** Expense groups in stage order; `after` names the trunk column that
	 * follows the peel (e.g. "After tax"). `remainderLabel` names what
	 * survives the final stage. */
	stages: { key: string; label: string; after: string; colorVar: string; amount: number }[];
	remainderLabel: string;
}

export interface WPath {
	d: string;
	colorVar: string;
	opacity: number;
}

export interface WNode {
	x: number;
	y: number;
	h: number;
	colorVar: string;
}

export interface WLabel {
	/** svg-space coordinates; the component converts to % offsets */
	x: number;
	y: number;
	name: string;
	amount: number;
	anchor: 'left' | 'right' | 'center';
	/** stage labels stack name over amount; edge labels flow inline */
	stacked: boolean;
}

export interface WaterfallLayout {
	width: number;
	height: number;
	paths: WPath[];
	nodes: WNode[];
	labels: WLabel[];
}

export const W = 1240;
export const H = 860;
const EDGE = 16;
const NODE_W = 11;
const LABEL_LINE_H = 26; // svg units ≈ one 12.5px line + amount line at 592px render

/**
 * Resolve vertical label collisions: walk the sorted column, and where
 * consecutive labels sit closer than `minGap`, centre that colliding block on
 * its members' mean preferred position, then clamp into [minY, maxY].
 *
 * Pool-adjacent-violators, not sweep-until-stable. A block's position is the
 * mean of its members' *preferred* positions, so recomputing block membership
 * from the *moved* positions — as a repeated sweep does — lets two
 * arrangements swap forever and never settle. Merging only ever reduces the
 * block count, so this terminates in at most one merge per label.
 */
export function relaxLabels(
	preferred: number[],
	minGap: number,
	minY: number,
	maxY: number
): number[] {
	if (preferred.length === 0) return [];
	const order = preferred.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);

	// Each block pins its members minGap apart, so member k of a block sits at
	// `top + k * minGap`. The top that minimises total drift is the mean of
	// (preferred − k · minGap) over the block's members; `sum` accumulates that
	// numerator. Merging block B (m members) onto block A (n members) shifts
	// every B member n places down the stack, hence the − n · m · minGap term.
	const blocks: { top: number; count: number; sum: number }[] = [];
	for (const { y } of order) {
		blocks.push({ top: y, count: 1, sum: y });
		while (blocks.length > 1) {
			const b = blocks[blocks.length - 1];
			const a = blocks[blocks.length - 2];
			if (a.top + a.count * minGap <= b.top) break;
			a.sum += b.sum - a.count * b.count * minGap;
			a.count += b.count;
			a.top = a.sum / a.count;
			blocks.pop();
		}
	}

	const placed: number[] = [];
	for (const block of blocks) {
		for (let k = 0; k < block.count; k++) placed.push(block.top + k * minGap);
	}

	// Clamp into the band without reintroducing overlap: one pass down enforces
	// the floor and the spacing, one pass up enforces the ceiling. Both are
	// bounded, so neither can spin.
	for (let k = 0; k < placed.length; k++) {
		placed[k] = Math.max(k === 0 ? minY : placed[k - 1] + minGap, placed[k]);
	}
	for (let k = placed.length - 1; k >= 0; k--) {
		placed[k] = Math.min(k === placed.length - 1 ? maxY : placed[k + 1] - minGap, placed[k]);
	}

	const out = new Array(preferred.length);
	order.forEach((o, k) => (out[o.i] = placed[k]));
	return out;
}

function ribbon(x0: number, y0: number, x1: number, y1: number, h0: number, h1: number): string {
	const xm = (x0 + x1) / 2;
	return (
		`M ${x0} ${y0} C ${xm} ${y0} ${xm} ${y1} ${x1} ${y1} ` +
		`L ${x1} ${y1 + h1} C ${xm} ${y1 + h1} ${xm} ${y0 + h0} ${x0} ${y0 + h0} Z`
	);
}

export function buildWaterfall(input: WaterfallInput): WaterfallLayout {
	const income = input.sources.reduce((s, x) => s + x.amount, 0);
	const layout: WaterfallLayout = { width: W, height: H, paths: [], nodes: [], labels: [] };
	if (income <= 0) return layout;

	const stageCount = input.stages.length;
	// Columns: sources | Income | one per stage remainder. The left margin
	// holds the source labels ("Salary · Robert 644 000"), which sit to the
	// left of the source bars and must not clip at the container edge.
	const x0 = 255;
	const xEnd = W - 150;
	const cols = stageCount + 2;
	const colX = (i: number) => x0 + ((xEnd - x0) / (cols - 1)) * i;

	const labelSpace = 64; // room above the trunk for stage labels
	const trunkTop = EDGE + labelSpace;

	// Vertical scale: income bar plus the deepest staircase of expense
	// terminals must fit. Start optimistic and shrink on overflow.
	let scale = (H * 0.52) / income;
	for (let attempt = 0; attempt < 8; attempt++) {
		const trunkHeights = [income];
		for (const stage of input.stages) {
			trunkHeights.push(trunkHeights[trunkHeights.length - 1] - stage.amount);
		}
		let deepest = trunkTop + income * scale;
		let terminalTop = 0;
		for (let k = 0; k < stageCount; k++) {
			const naturalTop = trunkTop + trunkHeights[k + 1] * scale + 44;
			terminalTop = Math.max(naturalTop, terminalTop + 30);
			// One unit taller than hOf's floor, so the measured depth is never
			// under the depth the layout pass below actually produces.
			const terminalH = Math.max(input.stages[k].amount * scale, 4);
			deepest = Math.max(deepest, terminalTop + terminalH);
			terminalTop += terminalH;
		}
		if (deepest <= H - EDGE) break;
		scale *= (H - EDGE - trunkTop) / (deepest - trunkTop);
	}

	const hOf = (amount: number) => Math.max(amount * scale, 3);

	// --- Column 0: income source bars + fan-in ---
	const sourceGap = 18;
	const totalSourceH = input.sources.reduce((s, x) => s + hOf(x.amount), 0);
	const sourcesTop =
		trunkTop +
		Math.max(0, (income * scale - totalSourceH - sourceGap * (input.sources.length - 1)) / 2);
	let sy = sourcesTop;
	let fanY = trunkTop;
	const sourceLabelPreferred: number[] = [];
	for (const source of input.sources) {
		const h = hOf(source.amount);
		layout.nodes.push({ x: colX(0) - NODE_W, y: sy, h, colorVar: '--green' });
		layout.paths.push({
			d: ribbon(colX(0), sy, colX(1), fanY, h, source.amount * scale),
			colorVar: '--green',
			opacity: 0.18
		});
		sourceLabelPreferred.push(sy + h / 2);
		sy += h + sourceGap;
		fanY += source.amount * scale;
	}
	const sourceYs = relaxLabels(sourceLabelPreferred, LABEL_LINE_H, EDGE + 8, H - EDGE - 8);
	input.sources.forEach((source, i) => {
		layout.labels.push({
			x: colX(0) - NODE_W - 10,
			y: sourceYs[i],
			name: source.name,
			amount: source.amount,
			anchor: 'right',
			stacked: false
		});
	});

	// --- Trunk stages ---
	let remaining = income;
	const stageNames = ['Income', ...input.stages.map((s) => s.after)];

	let terminalTopFloor = 0;
	for (let k = 0; k <= stageCount; k++) {
		const x = colX(k + 1);
		const h = hOf(remaining);
		layout.nodes.push({ x: x - NODE_W / 2, y: trunkTop, h, colorVar: '--green' });
		// Stage label above the trunk: two stacked lines ending just above the node.
		layout.labels.push({
			x,
			y: trunkTop - 34,
			name: k === stageCount ? input.remainderLabel : stageNames[k],
			amount: remaining,
			anchor: 'center',
			stacked: true
		});

		if (k < stageCount) {
			const stage = input.stages[k];
			const nextRemaining = remaining - stage.amount;
			// Trunk ribbon to the next column (top-aligned).
			layout.paths.push({
				d: ribbon(
					x + NODE_W / 2,
					trunkTop,
					colX(k + 2) - NODE_W / 2,
					trunkTop,
					hOf(nextRemaining),
					hOf(nextRemaining)
				),
				colorVar: '--green',
				opacity: 0.18
			});
			// Expense ribbon: leaves the bottom slice, lands on a terminal bar.
			const naturalTop = trunkTop + hOf(nextRemaining) + 44;
			const terminalTop = Math.max(naturalTop, terminalTopFloor + 30);
			const terminalH = hOf(stage.amount);
			const terminalX = colX(k + 2) - NODE_W / 2 - 40;
			layout.paths.push({
				d: ribbon(
					x + NODE_W / 2,
					trunkTop + hOf(nextRemaining),
					terminalX,
					terminalTop,
					hOf(stage.amount),
					terminalH
				),
				colorVar: stage.colorVar,
				opacity: 0.28
			});
			layout.nodes.push({ x: terminalX, y: terminalTop, h: terminalH, colorVar: stage.colorVar });
			layout.labels.push({
				x: terminalX + NODE_W + 10,
				y: terminalTop + terminalH / 2,
				name: stage.label,
				amount: stage.amount,
				anchor: 'left',
				stacked: false
			});
			terminalTopFloor = terminalTop + terminalH;
			remaining = nextRemaining;
		}
	}

	// Final clamp for every label (relaxation already spaced the tight column).
	for (const label of layout.labels) {
		label.y = Math.max(EDGE + 8, Math.min(label.y, H - EDGE - 8));
	}

	return layout;
}
