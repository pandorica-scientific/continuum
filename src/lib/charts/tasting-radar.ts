// SPDX-License-Identifier: AGPL-3.0-or-later
// The shape a bottle's tasting notes make.
//
// One axis per distinct flavour word; distance from the centre is how many
// tastings mentioned it, normalised to the most-mentioned. So the outer ring is
// always reached by something and the web is about THIS bottle rather than
// about some absolute scale of plumminess.
//
// Geometry only, no DOM — the product's rule for every chart, and the reason
// this can be tested without a browser.

/** Below this many distinct notes there is no shape to draw, only a line. */
export const LEAST_AXES = 3;

/** How many rings the web is drawn on. */
export const RINGS = 3;

export interface Mention {
	note: string;
	/** How many tastings mentioned it. */
	count: number;
	/** The `--series-*` slot the note is inked in. */
	series: string;
}

export interface RadarAxis extends Mention {
	/** Where the dot sits, in the SVG's own coordinates. */
	x: number;
	y: number;
	/** Where the label pill sits, just outside the web. */
	labelX: number;
	labelY: number;
	/** 0–1, this note's share of the most-mentioned one. */
	reach: number;
}

export interface Radar {
	size: number;
	centre: number;
	radius: number;
	axes: RadarAxis[];
	/** The ring radii, outermost last. */
	rings: number[];
	/** The filled polygon, closed. Empty when there is no shape to draw. */
	points: string;
	/** Where each spoke ends, for the web's lines. */
	spokes: { x: number; y: number }[];
}

/**
 * Lay out the web.
 *
 * `size` is the SVG's square side; the label pills are positioned by the
 * component in HTML over the top, which is why their coordinates come back
 * separately — a rounded pill drawn in SVG text cannot have a background.
 */
export function tastingRadar(mentions: Mention[], size = 240, labelGap = 18): Radar {
	const centre = size / 2;
	// Room for the pills outside the web, so a long word does not run off the
	// square. The pills themselves are laid out in HTML and can overhang; the
	// web must not.
	const radius = centre * 0.62;
	const rings = Array.from({ length: RINGS }, (_, at) => (radius * (at + 1)) / RINGS);

	if (mentions.length < LEAST_AXES) {
		return { size, centre, radius, axes: [], rings, points: '', spokes: [] };
	}

	// Normalised to the most-mentioned note, so something always reaches the
	// outer ring. A note mentioned once among ones mentioned five times sits at
	// a fifth of the way out, which is the comparison worth seeing.
	const most = Math.max(...mentions.map((one) => one.count));

	const axes = mentions.map((one, at): RadarAxis => {
		// Straight up first, then clockwise: a web that starts at three o'clock
		// reads as rotated by everybody who has seen one before.
		const angle = (at / mentions.length) * Math.PI * 2 - Math.PI / 2;
		const reach = most > 0 ? one.count / most : 0;
		return {
			...one,
			reach,
			x: centre + Math.cos(angle) * radius * reach,
			y: centre + Math.sin(angle) * radius * reach,
			labelX: centre + Math.cos(angle) * (radius + labelGap),
			labelY: centre + Math.sin(angle) * (radius + labelGap)
		};
	});

	const spokes = mentions.map((_, at) => {
		const angle = (at / mentions.length) * Math.PI * 2 - Math.PI / 2;
		return { x: centre + Math.cos(angle) * radius, y: centre + Math.sin(angle) * radius };
	});

	return {
		size,
		centre,
		radius,
		axes,
		rings,
		// SVG closes a `polygon` itself, but the string is written closed so a
		// reader of the markup can see that it does.
		points: [...axes, axes[0]].map((axis) => `${round(axis.x)},${round(axis.y)}`).join(' '),
		spokes
	};
}

/** Two decimals is well past sub-pixel at any size this is drawn. */
const round = (value: number): number => Math.round(value * 100) / 100;
