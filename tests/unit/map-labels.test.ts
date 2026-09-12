// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which region names the country map prints.
 *
 * The rules are the handoff prototype's, and they are all about not lying: a
 * name must fit the region it names, and must not sit on one already placed.
 * The world map has no names at all, which is why nothing here tests it.
 */
import { describe, expect, it } from 'vitest';
import { placeRegionLabels, wrapLabel, type RegionPlaceable } from '$lib/life/map/labels';

/** A region whose biggest piece is `width` × `height`, centred at (x, y). */
const region = (
	name: string,
	x: number,
	y: number,
	width: number,
	height: number,
	scratched = false
): RegionPlaceable => ({ name, x, y, mainWidth: width, mainHeight: height, scratched });

describe('wrapping a long name', () => {
	it('leaves a short one alone', () => {
		expect(wrapLabel('Porto')).toEqual(['Porto']);
		expect(wrapLabel('Bragança')).toEqual(['Bragança']);
	});

	// Hyphenating a place is worse than dropping its label.
	it('leaves a long one alone when it has no space to break at', () => {
		expect(wrapLabel('Liechtensteinish')).toEqual(['Liechtensteinish']);
	});

	it('splits as evenly as the words allow', () => {
		expect(wrapLabel('Viana do Castelo')).toEqual(['Viana do', 'Castelo']);
		expect(wrapLabel('Castelo Branco')).toEqual(['Castelo', 'Branco']);
	});
});

describe('whether a region carries its name', () => {
	it('prints one the region has room for', () => {
		expect(placeRegionLabels([region('Porto', 300, 200, 200, 120)]).map((one) => one.name)).toEqual(
			['Porto']
		);
	});

	// A word over a sliver labels its neighbours.
	it('drops one where the region is too narrow', () => {
		expect(placeRegionLabels([region('Porto', 300, 200, 5, 120)])).toEqual([]);
	});

	it('drops one where the region is too short', () => {
		expect(placeRegionLabels([region('Porto', 300, 200, 200, 3)])).toEqual([]);
	});

	it('has nothing to say about a region with no name', () => {
		expect(placeRegionLabels([region('', 300, 200, 200, 120)])).toEqual([]);
	});
});

describe('when two names want the same place', () => {
	it('keeps the first and drops the second', () => {
		const placed = placeRegionLabels([
			region('Porto', 300, 200, 200, 120),
			region('Braga', 305, 202, 190, 110)
		]);
		expect(placed).toHaveLength(1);
	});

	// A region somebody has been to earns its name before a neighbour takes it.
	it('gives the room to the scratched one whatever order they arrive in', () => {
		const been = region('Porto', 300, 200, 150, 110, true);
		const not = region('Braga', 302, 201, 200, 120);
		expect(placeRegionLabels([not, been])[0].name).toBe('Porto');
		expect(placeRegionLabels([been, not])[0].name).toBe('Porto');
	});

	it('falls back to the widest where neither is scratched', () => {
		const wide = region('Braga', 302, 201, 200, 120);
		const narrow = region('Porto', 300, 200, 150, 110);
		expect(placeRegionLabels([narrow, wide])[0].name).toBe('Braga');
	});

	it('prints both where they are clear of each other', () => {
		const placed = placeRegionLabels([
			region('Porto', 120, 100, 200, 120),
			region('Faro', 600, 320, 200, 120)
		]);
		expect(placed.map((one) => one.name).sort()).toEqual(['Faro', 'Porto']);
	});
});

describe('what gets printed', () => {
	it('carries the wrap as a newline the markup can honour', () => {
		const [label] = placeRegionLabels([region('Viana do Castelo', 300, 200, 400, 200)]);
		expect(label.text).toBe('Viana do\nCastelo');
		expect(label.lines).toBe(2);
	});

	it('is centred on the region', () => {
		const [label] = placeRegionLabels([region('Porto', 300, 150, 400, 200)]);
		expect(label.x).toBe(300);
		expect(label.y).toBe(150);
	});

	it('is as wide as the longest line', () => {
		const [short] = placeRegionLabels([region('Faro', 300, 150, 400, 200)]);
		const [long] = placeRegionLabels([region('Portalegre', 300, 150, 400, 200)]);
		expect(short.width).toBeLessThan(long.width);
	});
});
