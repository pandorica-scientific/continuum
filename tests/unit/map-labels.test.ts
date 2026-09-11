// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which country names the map prints.
 *
 * The rules are the handoff prototype's, and they are all about not lying: a
 * label must fit the country it names, must stay inside the frame, and must not
 * sit on one already placed.
 */
import { describe, expect, it } from 'vitest';
import { ANCHORS, labelWidth, placeLabels, wrapLabel, type Placeable } from '$lib/life/map/labels';

/** A country `width` × `height` units, centred at (cx, cy). */
const box = (name: string, cx: number, cy: number, width: number, height: number): Placeable => ({
	name,
	centroid: [cx, cy],
	bounds: [
		[cx - width / 2, cy - height / 2],
		[cx + width / 2, cy + height / 2]
	],
	area: width * height
});

/** Everything is visited unless a test says otherwise. */
const all = () => true;

describe('wrapping a long name', () => {
	it('leaves a short one alone', () => {
		expect(wrapLabel('Peru')).toEqual(['Peru']);
		expect(wrapLabel('Australia')).toEqual(['Australia']);
	});

	// Hyphenating a country is worse than dropping its label.
	it('leaves a long one alone when it has no space to break at', () => {
		expect(wrapLabel('Liechtensteinish')).toEqual(['Liechtensteinish']);
	});

	it('splits as evenly as the words allow', () => {
		expect(wrapLabel('Bosnia and Herzegovina')).toEqual(['Bosnia and', 'Herzegovina']);
		expect(wrapLabel('Central African Republic')).toEqual(['Central African', 'Republic']);
	});
});

describe('which countries are candidates', () => {
	it('labels somewhere the household has been', () => {
		const placed = placeLabels([box('Peru', 300, 200, 300, 200)], (name) => name === 'Peru');
		expect(placed.map((one) => one.name)).toEqual(['Peru']);
	});

	// A world map showing only the six places somebody has been is a puzzle.
	it('labels the anchors even where nobody has been', () => {
		expect(ANCHORS).toContain('Brazil');
		const placed = placeLabels([box('Brazil', 300, 200, 300, 200)], () => false);
		expect(placed.map((one) => one.name)).toEqual(['Brazil']);
	});

	it('says nothing about a country that is neither', () => {
		expect(placeLabels([box('Paraguay', 300, 200, 300, 200)], () => false)).toEqual([]);
	});

	it('has nothing to say about a country with no name', () => {
		expect(placeLabels([box('', 300, 200, 400, 400)], all)).toEqual([]);
	});
});

describe('whether a label fits', () => {
	// A word wider than Luxembourg, centred on Luxembourg, labels Belgium too.
	it('drops one the country is far too narrow for', () => {
		expect(placeLabels([box('Luxembourg', 300, 200, 6, 40)], all)).toEqual([]);
	});

	// A quarter's overhang is allowed: a name that runs just past a coastline
	// still reads as belonging to it.
	it('allows a small overhang', () => {
		const name = 'Peru';
		const justOver = labelWidth(name) / 1.1;
		expect(placeLabels([box(name, 300, 200, justOver, 40)], all)).toHaveLength(1);
	});

	it('drops one where the country is too short to hold a line', () => {
		expect(placeLabels([box('Chile', 300, 200, 400, 4)], all)).toEqual([]);
	});

	it('drops one whose box would leave the frame', () => {
		expect(placeLabels([box('Peru', 4, 200, 400, 200)], all)).toEqual([]);
		expect(placeLabels([box('Peru', 300, 478, 400, 200)], all)).toEqual([]);
	});
});

describe('when two labels want the same place', () => {
	it('keeps the first and drops the second', () => {
		const placed = placeLabels(
			[box('Brazil', 300, 200, 300, 200), box('Peru', 305, 202, 290, 190)],
			all
		);
		expect(placed).toHaveLength(1);
	});

	// A visited country claims its space before an anchor takes it.
	it('gives the room to somewhere the household has been', () => {
		const been = box('Peru', 300, 200, 300, 200);
		const anchor = box('Brazil', 302, 201, 320, 200);
		const visited = (name: string) => name === 'Peru';
		expect(placeLabels([anchor, been], visited)[0].name).toBe('Peru');
		expect(placeLabels([been, anchor], visited)[0].name).toBe('Peru');
	});

	it('prints both where they are clear of each other', () => {
		const placed = placeLabels(
			[box('Peru', 200, 120, 300, 200), box('Brazil', 700, 360, 300, 200)],
			all
		);
		expect(placed.map((one) => one.name).sort()).toEqual(['Brazil', 'Peru']);
	});
});

describe('the zoomed map', () => {
	/**
	 * A label that did not fit at 1× fits at 4×, and leaving the same dozen
	 * names on a zoomed map wastes the zoom.
	 */
	it('places a name the country was too small for once it is zoomed', () => {
		const small = box('Peru', 480, 240, 10, 8);
		expect(placeLabels([small], all)).toEqual([]);
		expect(
			placeLabels([small], all, { k: 4, tx: -1440, ty: -720, width: 960, height: 480 })
		).toHaveLength(1);
	});

	it('measures the position through the same transform', () => {
		const country = box('Peru', 240, 120, 300, 200);
		const [label] = placeLabels([country], all, {
			k: 2,
			tx: -100,
			ty: -50,
			width: 960,
			height: 480
		});
		expect(label.x).toBe(-100 + 2 * 240);
		expect(label.y).toBe(-50 + 2 * 120);
	});
});

describe('what gets printed', () => {
	// "United States of America" on one line is wider than the country; the
	// short name is what wraps, so the label reads as two balanced lines rather
	// than being dropped for not fitting.
	it('says United States, not its formal name', () => {
		const [label] = placeLabels([box('United States of America', 480, 240, 400, 200)], all);
		expect(label.text).toBe('United\nStates');
		expect(label.text).not.toContain('America');
	});

	it('carries the wrap as a newline the markup can honour', () => {
		const [label] = placeLabels([box('Bosnia and Herzegovina', 480, 240, 400, 200)], all);
		expect(label.text).toBe('Bosnia and\nHerzegovina');
		expect(label.lines).toBe(2);
	});

	it('grows with the length of the name', () => {
		expect(labelWidth('Chad')).toBeLessThan(labelWidth('Kazakhstan'));
	});
});
