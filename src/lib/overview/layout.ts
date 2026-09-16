// SPDX-License-Identifier: AGPL-3.0-or-later
// The Overview board's spatial arithmetic, kept pure: no DOM, no Svelte.
// Components call these functions; they never do grid maths themselves.

/** One panel's place on the twelve-column grid. */
export interface OverviewPlacement {
	/** Panel key, matching an entry in the panel registry. */
	k: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

export const COLUMNS = 12;

function overlaps(a: OverviewPlacement, b: OverviewPlacement): boolean {
	return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The smallest a panel may be shrunk to, from the panel registry. */
export interface PanelBounds {
	minW: number;
	minH: number;
}

const whole = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;

/**
 * Make a stored or posted layout safe to use. The layout lives in a jsonb
 * column, so this is the trust boundary; it runs on write and read. Sanitises
 * only — module gating is `visible`'s job, since a gated panel's entry must
 * survive in storage so re-enabling the module restores its placement.
 */
export function normalise(
	layout: readonly OverviewPlacement[],
	known: Record<string, PanelBounds>
): OverviewPlacement[] {
	const seen = new Set<string>();
	const out: OverviewPlacement[] = [];

	for (const placement of layout ?? []) {
		// Object.hasOwn, not a plain lookup: a posted key of "constructor" or
		// "__proto__" would otherwise pass via Object.prototype and take
		// `undefined` minimums, writing NaN geometry.
		if (!placement || !Object.hasOwn(known, placement.k)) continue;
		const bounds = known[placement.k];
		// A panel is placed once: a repeat would render twice.
		if (seen.has(placement.k)) continue;

		const x = whole(placement.x);
		const y = whole(placement.y);
		const w = whole(placement.w);
		const h = whole(placement.h);
		if (x === null || y === null || w === null || h === null) continue;

		const width = Math.min(COLUMNS, Math.max(bounds.minW, w));
		out.push({
			k: placement.k,
			// Clamped after width, so a wide panel is pulled onto the grid rather than hung off the edge.
			x: Math.min(COLUMNS - width, Math.max(0, x)),
			y: Math.max(0, y),
			w: width,
			h: Math.max(bounds.minH, h)
		});
		seen.add(placement.k);
	}

	return out;
}

/**
 * The panels this person can actually see right now, closed up. Dropping a
 * switched-off module's panel leaves a hole; the same compaction that runs
 * after every edit closes it here too, so there's no special case for module gaps.
 */
export function visible(
	layout: readonly OverviewPlacement[],
	isAvailable: (key: string) => boolean
): OverviewPlacement[] {
	return compact(layout.filter((p) => isAvailable(p.k)));
}

/**
 * Where a newly added panel of this size goes: the first cell it fits in,
 * scanning rows top to bottom, columns left to right — fills holes before
 * extending the board.
 */
export function firstFreeSlot(
	layout: OverviewPlacement[],
	w: number,
	h: number
): { x: number; y: number } {
	// One row past the deepest panel is always free, which bounds the scan.
	const floor = layout.reduce((deepest, p) => Math.max(deepest, p.y + p.h), 0);

	for (let y = 0; y <= floor; y++) {
		for (let x = 0; x <= COLUMNS - w; x++) {
			const candidate = { k: '', x, y, w, h };
			if (!layout.some((other) => overlaps(candidate, other))) return { x, y };
		}
	}

	return { x: 0, y: floor };
}

/**
 * Place each panel as high as it will go without landing on one already down,
 * taking them in the order given and leaving columns and sizes alone.
 */
function packOnto(
	list: readonly OverviewPlacement[],
	obstacles: OverviewPlacement[]
): OverviewPlacement[] {
	const placed = [...obstacles];
	const out: OverviewPlacement[] = [];

	for (const panel of list) {
		const next = { ...panel, y: 0 };
		// Re-scan after each drop: clearing one panel can land it on another.
		for (let moved = true; moved;) {
			moved = false;
			for (const other of placed) {
				if (overlaps(next, other)) {
					next.y = other.y + other.h;
					moved = true;
				}
			}
		}
		placed.push(next);
		out.push(next);
	}

	return out;
}

/**
 * Lay the list out in the order given — what the narrow single-column view
 * reorders with. Exchanging two panels' cells can't do it: a short panel
 * traded with a tall one overlaps it and gets pushed straight back below.
 * Order-preserving on a well-formed board, and doesn't flatten the layout —
 * panels side by side that don't obstruct each other keep their row.
 */
export function packInOrder(layout: readonly OverviewPlacement[]): OverviewPlacement[] {
	return packOnto(layout, []);
}

/**
 * Pull the whole board up so it holds no empty rows. The board has gravity: a
 * panel dropped below a gap rises to close it. Reading order (top to bottom,
 * then left to right) decides who gets each row.
 *
 * `pinned` holds one panel at exactly its current cell and packs everything
 * else around it — needed during a drag, so the panel under the cursor isn't
 * tugged off the pointer. It's an obstacle, not a member of the packed list,
 * since packing starts every panel at row zero.
 */
export function compact(
	layout: readonly OverviewPlacement[],
	pinned?: number
): OverviewPlacement[] {
	const held = pinned === undefined ? [] : [{ ...layout[pinned] }];

	const ranked = layout
		.map((placement, index) => ({ placement, index }))
		.filter(({ index }) => index !== pinned)
		.sort((a, b) => a.placement.y - b.placement.y || a.placement.x - b.placement.x);

	const packed = packOnto(
		ranked.map((entry) => entry.placement),
		held
	);

	const byIndex = new Map<number, OverviewPlacement>();
	if (pinned !== undefined) byIndex.set(pinned, held[0]);
	ranked.forEach((entry, position) => byIndex.set(entry.index, packed[position]));

	// Callers hold indices, so the result keeps the input's order.
	return layout.map((_, index) => byIndex.get(index)!);
}
