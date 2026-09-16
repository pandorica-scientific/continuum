import { describe, expect, it } from 'vitest';
import {
	firstFreeSlot,
	packInOrder,
	normalise,
	compact,
	visible,
	type OverviewPlacement
} from '$lib/overview/layout';

const known = {
	a: { minW: 4, minH: 3 },
	b: { minW: 4, minH: 3 },
	c: { minW: 4, minH: 3 },
	wide: { minW: 6, minH: 5 }
};

const at = (k: string, x: number, y: number, w: number, h: number): OverviewPlacement => ({
	k,
	x,
	y,
	w,
	h
});

describe('firstFreeSlot', () => {
	it('puts the first panel at the origin', () => {
		expect(firstFreeSlot([], 6, 4)).toEqual({ x: 0, y: 0 });
	});

	// Left to right before top to bottom, so a second half-width panel fills the row.
	it('fills the space beside an existing panel before starting a row', () => {
		expect(firstFreeSlot([at('a', 0, 0, 6, 4)], 6, 4)).toEqual({ x: 6, y: 0 });
	});

	it('starts a new row when the existing one is full', () => {
		expect(firstFreeSlot([at('a', 0, 0, 12, 4)], 6, 4)).toEqual({ x: 0, y: 4 });
	});

	// A twelve-wide panel cannot sit beside anything, however much room is left.
	it('respects the twelve-column bound', () => {
		expect(firstFreeSlot([at('a', 0, 0, 6, 4)], 12, 4)).toEqual({ x: 0, y: 4 });
	});

	it('reuses a hole beside an existing panel', () => {
		const layout = [at('a', 0, 0, 6, 4), at('b', 0, 4, 12, 4)];

		expect(firstFreeSlot(layout, 6, 4)).toEqual({ x: 6, y: 0 });
	});
});

// jsonb stores whatever it's handed; this is the trust boundary, run on write and read.
describe('normalise', () => {
	it('drops keys that are not panels', () => {
		const layout = [at('a', 0, 0, 6, 4), at('nonsense', 6, 0, 6, 4)];

		expect(normalise(layout, known).map((p) => p.k)).toEqual(['a']);
	});

	// A panel is placed once; duplicate keys would render it twice and break key-addressed operations.
	it('keeps only the first entry for a repeated panel', () => {
		const layout = [at('a', 0, 0, 6, 4), at('a', 6, 0, 6, 4)];

		expect(normalise(layout, known)).toEqual([at('a', 0, 0, 6, 4)]);
	});

	it('grows a panel below its minimum size back up to it', () => {
		const [only] = normalise([at('wide', 0, 0, 2, 1)], known);

		expect(only.w).toBe(6);
		expect(only.h).toBe(5);
	});

	it('holds width to the twelve-column grid', () => {
		expect(normalise([at('a', 0, 0, 40, 4)], known)[0].w).toBe(12);
	});

	// Clamping width without moving x would leave a panel hanging off the grid.
	it('pulls a panel back so it fits inside the grid', () => {
		expect(normalise([at('a', 9, 0, 6, 4)], known)[0].x).toBe(6);
	});

	it('lifts a negative row to zero', () => {
		expect(normalise([at('a', 0, -5, 6, 4)], known)[0].y).toBe(0);
	});

	// Regression: prototype-inherited keys (constructor, __proto__) passed the bounds
	// lookup and wrote NaN geometry into the database.
	it('refuses a key inherited from Object.prototype', () => {
		for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
			expect(normalise([{ k, x: 0, y: 0, w: 6, h: 4 }], known)).toEqual([]);
		}
	});

	// Hand-posted JSON is not obliged to contain numbers.
	it('discards entries whose geometry is not a number', () => {
		const layout = [
			{ k: 'a', x: Number.NaN, y: 0, w: 6, h: 4 },
			{ k: 'b', x: 0, y: 0, w: 6, h: 4 }
		];

		expect(normalise(layout, known).map((p) => p.k)).toEqual(['b']);
	});

	it('rounds fractional coordinates to whole cells', () => {
		expect(normalise([at('a', 1.7, 2.2, 6, 4)], known)[0]).toMatchObject({ x: 2, y: 2 });
	});
});

describe('visible', () => {
	// The entry stays in storage so re-enabling the module restores the panel;
	// it must just not render while off.
	it('leaves out panels whose module is off', () => {
		const layout = [at('a', 0, 0, 6, 4), at('b', 6, 0, 6, 4)];

		expect(visible(layout, (k) => k !== 'b').map((p) => p.k)).toEqual(['a']);
	});

	// Admin-made gaps (not the person's own layout choice) are the one case that closes up.
	it('closes the gap a hidden panel leaves behind', () => {
		const layout = [at('a', 0, 0, 12, 6), at('b', 0, 6, 12, 19)];

		expect(visible(layout, (k) => k !== 'a')).toEqual([at('b', 0, 0, 12, 19)]);
	});

	it('only lifts panels sharing the hidden panel columns', () => {
		const layout = [at('a', 0, 0, 6, 4), at('b', 6, 0, 6, 8), at('c', 0, 4, 6, 4)];

		const shown = visible(layout, (k) => k !== 'a');

		expect(shown.find((p) => p.k === 'c')?.y).toBe(0);
		expect(shown.find((p) => p.k === 'b')?.y).toBe(0);
	});

	// Regression: hidden panels measured against an already-shifted y, so only the
	// first gap in a column ever closed.
	it('closes the space of several hidden panels stacked in one column', () => {
		const layout = [at('a', 0, 0, 12, 5), at('b', 0, 5, 12, 5), at('c', 0, 10, 12, 6)];

		expect(visible(layout, (k) => k === 'c')).toEqual([at('c', 0, 0, 12, 6)]);
	});

	it('closes any other empty row while it is at it', () => {
		const layout = [at('a', 0, 0, 6, 4), at('b', 0, 10, 6, 4)];

		expect(visible(layout, () => true)).toEqual([at('a', 0, 0, 6, 4), at('b', 0, 4, 6, 4)]);
	});
});

// A swap would leave differently-sized panels overlapping; packing lays the list
// out in the order given instead.
describe('packInOrder', () => {
	it('leaves a well-formed board exactly as it is', () => {
		const layout = [
			at('briefing', 0, 0, 12, 6),
			at('flow', 0, 6, 12, 19),
			at('composition', 0, 25, 6, 6),
			at('upcoming', 6, 25, 6, 7)
		];

		expect(packInOrder(layout)).toEqual(layout);
	});

	// The case a swap can't do: the taller panel takes the top, the shorter lands below it.
	it('realises a new order across panels of different heights', () => {
		const layout = [at('tall', 0, 0, 12, 19), at('short', 0, 19, 12, 6)];

		expect(packInOrder(layout)).toEqual(layout);
		expect(packInOrder([layout[1], layout[0]])).toEqual([
			at('short', 0, 0, 12, 6),
			at('tall', 0, 6, 12, 19)
		]);
	});

	// Packing must not flatten the board into one column; side-by-side panels stay so.
	it('keeps a side-by-side pair on the same row', () => {
		const packed = packInOrder([at('a', 0, 9, 6, 6), at('b', 6, 9, 6, 6)]);

		expect(packed[0].y).toBe(0);
		expect(packed[1].y).toBe(0);
	});

	it('keeps every panel its column and size', () => {
		const packed = packInOrder([at('a', 6, 4, 6, 5), at('b', 0, 0, 4, 3)]);

		expect(packed[0]).toMatchObject({ k: 'a', x: 6, w: 6, h: 5 });
		expect(packed[1]).toMatchObject({ k: 'b', x: 0, w: 4, h: 3 });
	});
});

// The board has gravity: free placement that leaves holes reads as broken, so
// compacting upward is intentional.
describe('compact', () => {
	it('pulls a panel up to close the row above it', () => {
		expect(compact([at('a', 0, 9, 6, 4)])).toEqual([at('a', 0, 0, 6, 4)]);
	});

	it('lifts a whole column, keeping its order', () => {
		const layout = [at('a', 0, 4, 12, 3), at('b', 0, 12, 12, 5)];

		expect(compact(layout)).toEqual([at('a', 0, 0, 12, 3), at('b', 0, 3, 12, 5)]);
	});

	// Reading order (cell position), not array order, decides who gets the higher row.
	it('ranks by cell, not by array position', () => {
		const layout = [at('later', 0, 8, 12, 4), at('higher', 0, 2, 12, 4)];

		const packed = compact(layout);

		expect(packed[0]).toEqual(at('later', 0, 4, 12, 4));
		expect(packed[1]).toEqual(at('higher', 0, 0, 12, 4));
	});

	it('leaves panels side by side on the same row', () => {
		const layout = [at('a', 0, 6, 6, 4), at('b', 6, 6, 6, 4)];

		expect(compact(layout)).toEqual([at('a', 0, 0, 6, 4), at('b', 6, 0, 6, 4)]);
	});

	it('is a no-op on a board that is already tight', () => {
		const layout = [at('a', 0, 0, 12, 6), at('b', 0, 6, 6, 4), at('c', 6, 6, 6, 4)];

		expect(compact(layout)).toEqual(layout);
	});

	// A panel being dragged must not move while the rest rearranges beneath it.
	it('holds a pinned panel exactly where it is', () => {
		const layout = [at('dragged', 0, 9, 6, 4), at('other', 0, 0, 6, 4)];

		const packed = compact(layout, 0);

		expect(packed[0]).toEqual(at('dragged', 0, 9, 6, 4));
		expect(packed[1]).toEqual(at('other', 0, 0, 6, 4));
	});

	it('packs the rest around a pinned panel', () => {
		const layout = [at('dragged', 0, 0, 12, 4), at('other', 0, 20, 12, 4)];

		expect(compact(layout, 0)[1]).toEqual(at('other', 0, 4, 12, 4));
	});
});
