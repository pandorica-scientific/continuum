// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The arithmetic behind the scratch, with no canvas in it.
 *
 * Ported from the handoff's prototype, which is the version that has actually
 * been used. These are the numbers it settled on; they are here rather than
 * inside the canvas engine so they can be tested without a DOM, and so the two
 * places that need them — the engine and anything measuring progress — cannot
 * disagree.
 */

/**
 * How wide the brush is for a region of this size.
 *
 * `sqrt(area) / 3.2`, clamped. Without it, scratching Luxembourg takes as many
 * strokes as scratching the United States: a fixed brush is a fixed number of
 * passes per unit area, and regions differ by four orders of magnitude.
 */
export const BRUSH_MIN = 15;
export const BRUSH_MAX = 78;

export function brushWidth(bounds: [[number, number], [number, number]]): number {
	const [[x0, y0], [x1, y1]] = bounds;
	const width = x1 - x0;
	const height = y1 - y0;
	if (!(width > 0) || !(height > 0)) return BRUSH_MIN + 3;
	return Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Math.sqrt(width * height) / 3.2));
}

/** A region flips to visited once this much of its coating is gone. */
export const CLEARED = 0.82;

/** Coating thinner than this counts as scratched through at a sample point. */
export const THIN = 0.38;

/**
 * Where to sample a region to ask how much coating is left.
 *
 * A grid over the region's box, stepped so a region gets roughly eighty points
 * however big it is, and capped so a continent-sized one does not cost thousands.
 * Points outside the region itself are dropped by the caller's `inside` test.
 */
export const MOST_SAMPLES = 220;

export function sampleGrid(
	bounds: [[number, number], [number, number]],
	inside: (x: number, y: number) => boolean
): { x: number; y: number }[] {
	const [[x0, y0], [x1, y1]] = bounds;
	const step = Math.max(6, Math.sqrt(Math.max(1, (x1 - x0) * (y1 - y0)) / 80));
	const out: { x: number; y: number }[] = [];

	for (let x = x0 + step / 2; x < x1 && out.length < MOST_SAMPLES; x += step) {
		for (let y = y0 + step / 2; y < y1 && out.length < MOST_SAMPLES; y += step) {
			if (inside(x, y)) out.push({ x, y });
		}
	}
	return out;
}

/**
 * How hard and how wide a stroke is, from how fast it moved.
 *
 * A fast drag is a harder scratch and a slightly wider one — which is how a
 * coin on a real card behaves, and it is what stops a slow careful drag from
 * clearing a region in one pass.
 */
export function strokePressure(distance: number, milliseconds: number): number {
	const speed = distance / Math.max(1, milliseconds);
	return Math.min(1, 0.55 + speed * 0.5);
}

export function strokeWidth(base: number, distance: number, milliseconds: number): number {
	const speed = distance / Math.max(1, milliseconds);
	return base * (1 + Math.min(0.4, speed * 0.25));
}

/**
 * How many stamps to lay along a stroke.
 *
 * The trail is interpolated between pointer samples: a fast drag reports two
 * points a hundred units apart, and stamping only at those two leaves a dotted
 * line rather than a scratch.
 */
export const stepsAlong = (distance: number, width: number): number =>
	Math.max(1, Math.ceil(distance / Math.max(2, width / 8)));
