// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The arithmetic behind the scratch, with no canvas in it — kept separate so
 * it can be tested without a DOM, and the engine and progress-measuring code
 * can't disagree.
 */

/**
 * How wide the brush is for a region of this size: `sqrt(area) / 3.2`,
 * clamped, so a fixed brush isn't a fixed number of passes regardless of
 * region size (which differ by four orders of magnitude).
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
 * Where to sample a region to ask how much coating is left: a grid over the
 * region's box, stepped for ~80 points regardless of size, capped so a
 * continent doesn't cost thousands.
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
 * How hard and how wide a stroke is, from how fast it moved — a fast drag
 * scratches harder and wider, stopping a slow careful drag from clearing a
 * region in one pass.
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
 * How many stamps to lay along a stroke — interpolates between sparse pointer
 * samples so a fast drag doesn't leave a dotted line.
 */
export const stepsAlong = (distance: number, width: number): number =>
	Math.max(1, Math.ceil(distance / Math.max(2, width / 8)));
