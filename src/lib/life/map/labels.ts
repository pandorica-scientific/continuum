// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which country names the map prints, and where.
 *
 * Ported from the handoff's prototype rather than re-derived. Its rules, in its
 * order, because they are the ones that have been looked at on a real map:
 *
 *   1. Only countries somebody has been to, plus a fixed list of big ones that
 *      anchor the world. Labelling all 240 is unreadable at any size.
 *   2. Visited first, then widest, so the ones that matter claim their space
 *      before a neighbour takes it.
 *   3. A long name wraps onto two lines, split as evenly as the words allow.
 *   4. Rejected if the word is wider than the country can carry, if the country
 *      is too short to hold a line, if the box leaves the frame, or if it
 *      overlaps one already placed.
 *
 * Pure: boxes in, boxes out. Nothing measures text — the width is estimated
 * from the character count at the one size labels are drawn in, which is what
 * the prototype does and is close enough to decide whether a word fits.
 */

/**
 * The countries that are always candidates.
 *
 * A world map with nothing but the six places a household has been reads as a
 * puzzle. These are the anchors people navigate by — the prototype's list,
 * unchanged.
 */
export const ANCHORS = [
	'Brazil',
	'Canada',
	'Russia',
	'China',
	'India',
	'Australia',
	'Argentina',
	'Algeria',
	'Kazakhstan',
	'Mongolia',
	'Egypt',
	'Turkey',
	'Sudan',
	'Mexico'
];

/** Estimated width per character at the size labels are drawn in. */
const PER_CHARACTER = 4.3;

/** A one-line label's height, and a two-line one's. */
const ONE_LINE = 10;
const TWO_LINES = 18;

/** A country shorter than this in projected units cannot carry a label at all. */
const SHORTEST = 7;

/** How much wider than its country a word may be before it is dropped. */
const SPILL = 1.25;

export interface Placeable {
	name: string;
	centroid: [number, number];
	bounds: [[number, number], [number, number]];
	area: number;
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

/**
 * Split a long name onto two lines, as evenly as its words allow.
 *
 * "United States of America" on one line is wider than the United States; on
 * two balanced lines it fits. A name with no space stays whole whatever its
 * length — hyphenating a country is worse than dropping its label.
 */
export function wrapLabel(name: string): string[] {
	if (name.length <= 11 || !name.includes(' ')) return [name];

	const words = name.split(' ');
	let best: [string, string] | null = null;
	let closest = Number.POSITIVE_INFINITY;

	for (let at = 1; at < words.length; at++) {
		const head = words.slice(0, at).join(' ');
		const tail = words.slice(at).join(' ');
		const difference = Math.abs(head.length - tail.length);
		if (difference < closest) {
			closest = difference;
			best = [head, tail];
		}
	}
	return best ?? [name];
}

/** What a country is called on a map, where that is not its formal name. */
const SHORT_NAMES: Record<string, string> = {
	'United States of America': 'United States'
};

export const labelWidth = (name: string): number => {
	const longest = wrapLabel(SHORT_NAMES[name] ?? name).reduce(
		(most, line) => Math.max(most, line.length),
		0
	);
	return longest * PER_CHARACTER;
};

type Box = { x0: number; y0: number; x1: number; y1: number };

const overlaps = (a: Box, b: Box): boolean =>
	a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Place what fits.
 *
 * `zoom` and the pan offsets are the map's current transform: a label is
 * measured against the country AS DRAWN, so zooming in lets more names appear
 * rather than leaving the same dozen.
 */
export function placeLabels(
	countries: Placeable[],
	visited: (name: string) => boolean = () => true,
	view: { k: number; tx: number; ty: number; width: number; height: number } = {
		k: 1,
		tx: 0,
		ty: 0,
		width: 960,
		height: 480
	}
): PlacedLabel[] {
	const candidates = countries
		.filter((country) => country.name && (visited(country.name) || ANCHORS.includes(country.name)))
		.sort((a, b) => {
			const mine = visited(a.name) ? 1 : 0;
			const theirs = visited(b.name) ? 1 : 0;
			// Visited first, then the widest — the ones that matter claim their
			// space before a neighbour takes it.
			return theirs - mine || b.bounds[1][0] - b.bounds[0][0] - (a.bounds[1][0] - a.bounds[0][0]);
		});

	const placed: PlacedLabel[] = [];
	const taken: Box[] = [];

	for (const country of candidates) {
		const text = wrapLabel(SHORT_NAMES[country.name] ?? country.name);
		const width = labelWidth(country.name);
		const height = text.length > 1 ? TWO_LINES : ONE_LINE;

		const drawnWidth = (country.bounds[1][0] - country.bounds[0][0]) * view.k;
		const drawnHeight = (country.bounds[1][1] - country.bounds[0][1]) * view.k;
		// Wider than the country can carry, or a country too thin to hold a line.
		if (width > drawnWidth * SPILL || drawnHeight < SHORTEST) continue;

		const cx = view.tx + view.k * country.centroid[0];
		const cy = view.ty + view.k * country.centroid[1];
		// Off the edge of the frame: a half-visible name is worse than none.
		if (
			cx - width / 2 < 2 ||
			cx + width / 2 > view.width - 2 ||
			cy - height / 2 < 2 ||
			cy + height / 2 > view.height - 2
		) {
			continue;
		}

		const box: Box = {
			x0: cx - width / 2 - 1,
			x1: cx + width / 2 + 1,
			y0: cy - height / 2 - 1,
			y1: cy + height / 2 + 1
		};
		if (taken.some((other) => overlaps(box, other))) continue;

		taken.push(box);
		placed.push({
			name: country.name,
			text: text.join('\n'),
			x: cx,
			y: cy,
			width,
			height,
			lines: text.length
		});
	}

	return placed;
}

/**
 * The same job for the provinces inside one country.
 *
 * The prototype's own numbers, and they differ from the world map's because the
 * type is bigger here: a country fills the frame, so its regions have room for
 * ~7.4 units per character rather than 4.3, and two lines cost 30 rather than
 * 18. A region thinner than a few units carries no name at all — a word over a
 * sliver labels its neighbours.
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
		// Scratched first, then the widest: a region somebody has been to earns
		// its name before an unvisited neighbour takes the space.
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
