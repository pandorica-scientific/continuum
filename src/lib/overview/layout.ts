// SPDX-License-Identifier: AGPL-3.0-or-later
// The Overview board's spatial arithmetic, kept pure: no DOM, no Svelte, no
// imports from the rest of the app. Every subtle bug on this screen will be a
// bug in here, so it has to be testable without a browser. Components call
// these functions; they never do grid maths themselves.

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
 * Make a stored or posted layout safe to use.
 *
 * The layout lives in a jsonb column, which stores whatever it is handed, so
 * this is the trust boundary and runs on write as well as on read. It sanitises
 * only — module gating is `visible`'s job, because a gated panel's entry has to
 * survive in storage so that re-enabling the module restores its placement.
 */
export function normalise(
	layout: readonly OverviewPlacement[],
	known: Record<string, PanelBounds>
): OverviewPlacement[] {
	const seen = new Set<string>();
	const out: OverviewPlacement[] = [];

	for (const placement of layout ?? []) {
		// Own properties only. A plain lookup also finds everything on
		// Object.prototype, so a posted key of "constructor" or "__proto__"
		// passed this check, took `undefined` minimums, and wrote NaN geometry —
		// which the next read then silently discarded.
		if (!placement || !Object.hasOwn(known, placement.k)) continue;
		const bounds = known[placement.k];
		// A panel is placed once: a repeat would render twice and break every
		// operation that addresses panels by key.
		if (seen.has(placement.k)) continue;

		const x = whole(placement.x);
		const y = whole(placement.y);
		const w = whole(placement.w);
		const h = whole(placement.h);
		if (x === null || y === null || w === null || h === null) continue;

		const width = Math.min(COLUMNS, Math.max(bounds.minW, w));
		out.push({
			k: placement.k,
			// Clamped after the width, so a wide panel is pulled back onto the
			// grid rather than left hanging off its right edge.
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
 * The panels this person can actually see right now, closed up.
 *
 * Dropping a switched-off module's panel leaves a hole, and the board has
 * gravity, so the same compaction that runs after every edit closes it here
 * too — no special case for module gaps.
 */
export function visible(
	layout: readonly OverviewPlacement[],
	isAvailable: (key: string) => boolean
): OverviewPlacement[] {
	return compact(layout.filter((p) => isAvailable(p.k)));
}

/**
 * Where a newly added panel of this size goes: the first cell it fits in,
 * scanning rows top to bottom and columns left to right.
 *
 * Add fills the board's holes before it extends the board — a half-width gap
 * beside an existing panel takes the new one rather than starting a fresh row.
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
 * Lay the list out in the order given.
 *
 * This is what the narrow single-column view reorders with. Exchanging two
 * panels' cells cannot do it: a six-row panel traded with a nineteen-row one
 * overlaps it, and the board pushes the shorter one straight back below the
 * taller, so the order on screen never changes.
 *
 * Order-preserving on a board that is already well formed, and it does not
 * flatten the layout: two panels side by side do not obstruct each other, so
 * they keep their row.
 */
export function packInOrder(layout: readonly OverviewPlacement[]): OverviewPlacement[] {
	return packOnto(layout, []);
}

/**
 * Pull the whole board up so it holds no empty rows.
 *
 * The board has gravity: a panel dropped below a gap rises to close it, and
 * whatever it was resting on rises behind it. Reading order — top to bottom,
 * then left to right — decides who gets each row, so a panel dropped above
 * another takes the higher slot regardless of array position.
 *
 * This reverses the rule the design started with, which kept a hole wherever
 * one was left on the grounds that the person's empty space was theirs. In use
 * it read as broken rather than deliberate.
 *
 * `pinned` holds one panel at exactly its current cell and packs everything
 * else around it — what a drag in progress needs, since the panel under the
 * cursor must not be tugged off the pointer while the board rearranges beneath
 * it. It is an obstacle rather than a member of the packed list, because
 * packing starts every panel at row zero.
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

	// Callers hold on to indices, so the result keeps the input's order.
	return layout.map((_, index) => byIndex.get(index)!);
}
