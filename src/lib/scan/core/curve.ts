// SPDX-License-Identifier: AGPL-3.0-or-later
// How far each edge of the page bows away from the straight line between its
// corners.
//
// Paper photographed off a table is rarely flat: A4 lifted at one corner curves
// along its length, a folded letter stands slightly open, a page in a book
// rises towards the spine. Four straight lines cannot describe any of that, and
// the consequence is not merely a slightly wrong crop — it is the mask's
// boundary being DENTED, which is what made the detector give up entirely on
// several real photographs.
//
// The measurement is deliberately one number per edge. A sheet of paper bows;
// it does not ripple. Fitting one parameter to nine samples is far steadier
// than following every wobble in a mask, and it cannot move the corners, which
// the rest of the pipeline has already agreed on.

import type { Corners, Edges, Frame, Point } from './types.ts';
import type { CV } from './opencv.ts';

/** Where along each edge the boundary is looked for. Never at the ends: those are corners. */
const SAMPLES = [0.15, 0.25, 0.35, 0.45, 0.5, 0.55, 0.65, 0.75, 0.85];

/** How far to either side of the chord to search, as a share of the frame's smaller side. */
const SEARCH_REACH = 0.06;

/**
 * How much bow is worth recording, as a share of the edge's own length.
 *
 * Below this the page is flat for every practical purpose, and saying otherwise
 * would put a mesh remap in the path of a photograph that does not need one.
 */
const MIN_BOW_FRACTION = 0.006;

/** How much bow is too much to believe, as a share of the edge's length. */
const MAX_BOW_FRACTION = 0.12;

/** The points handed to the model for a bowed edge. */
const CURVE_POINTS = 7;

/** The four edges, each as the corners it runs between, in model order. */
const EDGES: ReadonlyArray<[keyof Edges, keyof Corners, keyof Corners]> = [
	['top', 'tl', 'tr'],
	['right', 'tr', 'br'],
	['bottom', 'br', 'bl'],
	['left', 'bl', 'tl']
];

/** The shape a bow takes: zero at both corners, greatest in the middle. */
const bowAt = (t: number) => Math.sin(Math.PI * t);

function median(values: number[]): number {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * How far the page's real boundary lies from the chord at one point along it.
 *
 * Walks outward from the chord in both directions at once and returns the first
 * place the mask changes, so a boundary that has moved IN and one that has moved
 * OUT are found by the same search. Null when nothing changes within reach —
 * which is the honest answer for an edge whose surroundings look like the page.
 */
function offsetAt(
	mask: InstanceType<CV['Mat']>,
	frame: Frame,
	at: Point,
	normal: Point,
	reach: number
): number | null {
	const read = (x: number, y: number): number | null => {
		const px = Math.round(x);
		const py = Math.round(y);
		if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) return null;
		return mask.data[py * frame.width + px];
	};

	const here = read(at.x, at.y);
	if (here === null) return null;

	for (let step = 1; step <= reach; step++) {
		for (const direction of [1, -1]) {
			const value = read(at.x + normal.x * step * direction, at.y + normal.y * step * direction);
			if (value === null) continue;
			// The first change of side IS the boundary. Which side the page is on
			// does not matter: the caller has already decided that, and this only
			// has to find where it stops.
			if (value !== here) return (step - 0.5) * direction;
		}
	}
	return null;
}

/**
 * Measure the bow of all four edges against the segmentation mask.
 *
 * Returns undefined for a page that is flat, so the ordinary photograph carries
 * no edges at all and nothing downstream has to decide whether four empty
 * arrays mean "straight" or "not measured".
 */
export function measureBow(
	cv: CV,
	mask: InstanceType<CV['Mat']>,
	corners: Corners,
	frame: Frame
): Edges | undefined {
	const reach = Math.max(4, Math.round(Math.min(frame.width, frame.height) * SEARCH_REACH));
	const edges: Edges = { top: [], right: [], bottom: [], left: [] };
	let bent = false;

	for (const [name, from, to] of EDGES) {
		const a = corners[from];
		const b = corners[to];
		const span = Math.hypot(b.x - a.x, b.y - a.y);
		if (span < 1) continue;
		// The unit normal of the chord. Which way it points does not matter; the
		// sign of the measured offset carries the direction.
		const normal = { x: -(b.y - a.y) / span, y: (b.x - a.x) / span };

		const amplitudes: number[] = [];
		for (const t of SAMPLES) {
			const on = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
			const offset = offsetAt(mask, frame, on, normal, reach);
			if (offset === null) continue;
			// Every sample is evidence about the SAME single number, scaled by how
			// far along the edge it was taken. Dividing it out means a sample near
			// a corner — where the bow is small and the measurement noisy — carries
			// no more weight than it should.
			amplitudes.push(offset / bowAt(t));
		}
		// A median rather than a mean: two or three samples landing on a shadow,
		// a thumb or a second sheet should not drag the curve with them.
		if (amplitudes.length < 4) continue;
		const amplitude = median(amplitudes);

		const share = Math.abs(amplitude) / span;
		// Too small to matter, or too large to believe — a huge "bow" is a
		// mis-segmentation, not a page, and bending the crop to match it would
		// turn a slightly wrong quad into a badly wrong curve.
		if (share < MIN_BOW_FRACTION || share > MAX_BOW_FRACTION) continue;

		const points: Point[] = [];
		for (let i = 1; i <= CURVE_POINTS; i++) {
			const t = i / (CURVE_POINTS + 1);
			const k = amplitude * bowAt(t);
			points.push({
				x: a.x + (b.x - a.x) * t + normal.x * k,
				y: a.y + (b.y - a.y) * t + normal.y * k
			});
		}
		edges[name] = points;
		bent = true;
	}

	return bent ? edges : undefined;
}
