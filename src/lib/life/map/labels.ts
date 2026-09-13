// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which region names the country map prints, and where.
 *
 * The prototype's rules, in its order: scratched regions claim their name
 * first, then the widest; a long name wraps onto two balanced lines; and a name
 * is dropped where its region is too small to carry it or where it would sit on
 * one already placed.
 *
 * The world map has no names at all — at that scale only a couple of dozen
 * countries can carry a legible word, so a labelled world map names the big
 * empty ones and stays silent about most of the places a household has been.
 *
 * Pure: boxes in, boxes out. Nothing measures text — the width is estimated
 * from the character count at the one size labels are drawn in, which is what
 * the prototype does and is close enough to decide whether a word fits.
 */

/**
 * Split a long name onto two lines, as evenly as its breaks allow.
 *
 * "United States of America" on one line is wider than the United States; on
 * two balanced lines it fits.
 *
 * Breaks at a space OR at a hyphen the name already contains. The hyphen case
 * is what France needs: since v0.9.1 the map draws régions, and half of them
 * are hyphenated with no space at all — "Nouvelle-Aquitaine" stayed one
 * eighteen-character line about 133 units wide, which collided with its
 * neighbours and was dropped, and so were Normandie, Centre-Val de Loire and
 * Provence-Alpes-Côte d'Azur. Four of France's thirteen went unnamed.
 *
 * A hyphen is NOT invented. Breaking after one that is already written is how
 * the name is punctuated; hyphenating a word that has none would be the app
 * inventing spelling, which is worse than dropping the label — so a name with
 * no break of either kind still stays whole whatever its length.
 */
export function wrapLabel(name: string): string[] {
	if (name.length <= 11) return [name];

	// Kept WITH the fragment it ends, so a broken line reads "Nouvelle-" and the
	// hyphen does not float at the start of the next one.
	//
	// Walked rather than split on `/(?<=-)|(?= )/`. A lookbehind is a parse
	// error before Safari 16.4, and a regex literal is parsed when the module
	// loads — so on an older iPad that expression would not have cost the map
	// its labels, it would have cost the map.
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
