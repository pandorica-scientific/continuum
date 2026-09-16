// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which region names the country map prints, and where.
 *
 * Scratched regions claim their name first, then the widest; a long name
 * wraps onto two balanced lines; a name is dropped where its region is too
 * small to carry it or it would overlap one already placed.
 *
 * The world map has no names at all — at that scale too few countries can
 * carry a legible word.
 *
 * Pure: boxes in, boxes out. Text width is estimated from character count at
 * the one size labels are drawn in, close enough to decide whether it fits.
 */

/**
 * Split a long name onto two balanced lines, breaking at a space or an
 * existing hyphen (e.g. "Nouvelle-Aquitaine") — never inventing a hyphen a
 * name doesn't already have.
 */
export function wrapLabel(name: string): string[] {
	if (name.length <= 11) return [name];

	// Walked rather than split on a lookbehind regex, which is a parse error
	// before Safari 16.4 and would have cost the whole module, not just the labels.
	const pieces: string[] = [];
	let piece = '';
	for (const character of name) {
		if (character === ' ' && piece) {
			pieces.push(piece);
			piece = '';
		}
		piece += character;
		if (character === '-') {
			pieces.push(piece);
			piece = '';
		}
	}
	if (piece) pieces.push(piece);
	if (pieces.length < 2) return [name];

	let best: [string, string] | null = null;
	let closest = Number.POSITIVE_INFINITY;

	for (let at = 1; at < pieces.length; at++) {
		const head = pieces.slice(0, at).join('').trimEnd();
		const tail = pieces.slice(at).join('').trimStart();
		if (!head || !tail) continue;
		const difference = Math.abs(head.length - tail.length);
		if (difference < closest) {
			closest = difference;
			best = [head, tail];
		}
	}
	return best ?? [name];
}

export interface PlacedLabel {
	name: string;
	/** What to print — two lines are separated by a newline. */
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	lines: number;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

const overlaps = (a: Box, b: Box): boolean =>
	a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * The same job for the provinces inside one country. Numbers differ from the
 * world map's — type is bigger here since a country fills the frame.
 */
const REGION_PER_CHARACTER = 7.4;
const REGION_ONE_LINE = 17;
const REGION_TWO_LINES = 30;
const REGION_MIN_WIDTH = 8;
const REGION_MIN_HEIGHT = 6;

export interface RegionPlaceable {
	name: string;
	/** Where the label goes: the centroid of the region's biggest piece. */
	x: number;
	y: number;
	/** The biggest piece's size, which is what has to hold the word. */
	mainWidth: number;
	mainHeight: number;
	scratched: boolean;
}

export function placeRegionLabels(regions: RegionPlaceable[]): PlacedLabel[] {
	const taken: Box[] = [];
	const placed: PlacedLabel[] = [];

	const order = [...regions]
		.filter((region) => region.name)
		// Scratched first, then widest — a visited region earns its name first.
		.sort((a, b) => Number(b.scratched) - Number(a.scratched) || b.mainWidth - a.mainWidth);

	for (const region of order) {
		if (region.mainHeight < REGION_MIN_HEIGHT || region.mainWidth < REGION_MIN_WIDTH) continue;

		const lines = wrapLabel(region.name);
		const longest = lines.reduce((most, line) => Math.max(most, line.length), 0);
		const width = longest * REGION_PER_CHARACTER;
		const height = lines.length > 1 ? REGION_TWO_LINES : REGION_ONE_LINE;

		const box: Box = {
			x0: region.x - width / 2 - 2,
			x1: region.x + width / 2 + 2,
			y0: region.y - height / 2 - 2,
			y1: region.y + height / 2 + 2
		};
		if (taken.some((other) => overlaps(box, other))) continue;

		taken.push(box);
		placed.push({
			name: region.name,
			text: lines.join('\n'),
			x: region.x,
			y: region.y,
			width,
			height,
			lines: lines.length
		});
	}

	return placed;
}
