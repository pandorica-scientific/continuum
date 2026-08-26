// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Output dimensions come from the corners the detector found, never from a
// constant somebody picked. The two constants here are format facts — the A4
// ratio, and 300 DPI across 210 mm — not preferences.

import type { Corners, Point } from './types.ts';

/** A4 at 300 DPI. Past this you are storing lens noise, not detail. */
export const MAX_OUTPUT_WIDTH = 2480;

/** Long edge over short edge for A4. */
export const A4_RATIO = Math.SQRT2;

/** Within this of A4, snap to it. Any wider and a receipt gets stretched into a page. */
const SNAP_TOLERANCE = 0.04;

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export function outputSize(corners: Corners): { width: number; height: number } {
	const { tl, tr, br, bl } = corners;
	// The LONGER of each opposing pair. On a tilted page the near edge is at true
	// scale and the far edge is foreshortened; averaging them, or taking the
	// first, squeezes the whole page by however far it was tilted.
	let width = Math.max(distance(tl, tr), distance(bl, br));
	let height = Math.max(distance(tl, bl), distance(tr, br));

	if (width <= 0 || height <= 0) return { width: 1, height: 1 };

	// Almost everything scanned in a Czech or Polish household is A4, and a page
	// that comes out at 1.40 instead of 1.414 reads as subtly wrong in a way
	// nobody can name.
	const ratio = height / width;
	if (Math.abs(ratio - A4_RATIO) / A4_RATIO <= SNAP_TOLERANCE) {
		height = width * A4_RATIO;
	} else if (Math.abs(1 / ratio - A4_RATIO) / A4_RATIO <= SNAP_TOLERANCE) {
		width = height * A4_RATIO;
	}

	if (width > MAX_OUTPUT_WIDTH) {
		height = (height * MAX_OUTPUT_WIDTH) / width;
		width = MAX_OUTPUT_WIDTH;
	}

	return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** Carry corners from the downscaled detection frame back to the full image. */
export function scaleCorners(corners: Corners, factor: number): Corners {
	const at = (p: Point) => ({ x: p.x * factor, y: p.y * factor });
	return { tl: at(corners.tl), tr: at(corners.tr), br: at(corners.br), bl: at(corners.bl) };
}

/**
 * What a null `corners` degrades to. With manual corner adjustment cut, this is
 * the only fallback there is — so it must produce something usable rather than
 * throwing.
 */
export function fullFrameCorners(width: number, height: number): Corners {
	return {
		tl: { x: 0, y: 0 },
		tr: { x: width, y: 0 },
		br: { x: width, y: height },
		bl: { x: 0, y: height }
	};
}

/**
 * A segment thinner than its own border gets no border.
 *
 * A 1px rect with a 1px stroke centred on its edges paints a ~2px band at full
 * strength, so a hairline segment becomes the loudest pixels on screen —
 * exactly backwards from what a thin stroke is asking for.
 */
export function hairline(raw: number): { width: number; stroked: boolean } {
	return { width: Math.max(0.8, raw), stroked: raw >= 2.5 };
}
