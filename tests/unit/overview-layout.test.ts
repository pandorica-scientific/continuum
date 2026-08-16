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

	// Left to right before top to bottom, so adding a second half-width panel
	// fills the row rather than starting a new one.
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

// A jsonb column stores whatever it is handed, so this is the trust boundary
// and it runs on write as well as on read.
describe('normalise', () => {
	it('drops keys that are not panels', () => {
		const layout = [at('a', 0, 0, 6, 4), at('nonsense', 6, 0, 6, 4)];

		expect(normalise(layout, known).map((p) => p.k)).toEqual(['a']);
	});

	// A panel is placed once. Two entries for one key would render it twice and
	// break every operation that addresses panels by key.
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

	// `known[k]` finds inherited properties, so a posted key of "constructor" or
	// "__proto__" once passed the bounds lookup and wrote NaN geometry into the
	// database. It self-healed on the next read, which made it quiet rather than
	// harmless.
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
	// The entry survives in storage so re-enabling the module restores the
	// panel; it simply must not render while the module is off.
	it('leaves out panels whose module is off', () => {
		const layout = [at('a', 0, 0, 6, 4), at('b', 6, 0, 6, 4)];

		expect(visible(layout, (k) => k !== 'b').map((p) => p.k)).toEqual(['a']);
	});

	// This gap is not the person's choice — an admin made it on their board —
	// so it is the one case where the board does close up.
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

	// Each hidden panel was measured against the panel's already-shifted y, so
	// only the first gap in a column ever closed and the board kept a band of
	// empty space at the top. Two module-owning panels switched off is enough.
	it('closes the space of several hidden panels stacked in one column', () => {
		const layout = [at('a', 0, 0, 12, 5), at('b', 0, 5, 12, 5), at('c', 0, 10, 12, 6)];

		expect(visible(layout, (k) => k === 'c')).toEqual([at('c', 0, 0, 12, 6)]);
	});

	it('closes any other empty row while it is at it', () => {
		const layout = [at('a', 0, 0, 6, 4), at('b', 0, 10, 6, 4)];

		expect(visible(layout, () => true)).toEqual([at('a', 0, 0, 6, 4), at('b', 0, 4, 6, 4)]);
	});
});

// Reordering a one-column view cannot be a swap: exchanging a six-row panel
// with a nineteen-row one leaves them overlapping, and `settle` then pushes the
// shorter one straight back below the taller. Packing lays the list out in the
// order given, which is what makes a phone reorder visible.
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

	// The case the swap could not do: the taller panel takes the top and the
	// shorter one lands below it rather than inside it.
	it('realises a new order across panels of different heights', () => {
		const layout = [at('tall', 0, 0, 12, 19), at('short', 0, 19, 12, 6)];

		expect(packInOrder(layout)).toEqual(layout);
		expect(packInOrder([layout[1], layout[0]])).toEqual([
			at('short', 0, 0, 12, 6),
			at('tall', 0, 6, 12, 19)
		]);
	});

	// Packing must not flatten the board into one column: two panels side by
	// side do not obstruct each other.
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

// The board has gravity. This reverses the rule the design started with —
// "nothing is ever compacted upward, the person's empty space is theirs to
// keep" — because free placement that leaves holes reads as broken rather than
// deliberate.
describe('compact', () => {
	it('pulls a panel up to close the row above it', () => {
		expect(compact([at('a', 0, 9, 6, 4)])).toEqual([at('a', 0, 0, 6, 4)]);
	});

	it('lifts a whole column, keeping its order', () => {
		const layout = [at('a', 0, 4, 12, 3), at('b', 0, 12, 12, 5)];

		expect(compact(layout)).toEqual([at('a', 0, 0, 12, 3), at('b', 0, 3, 12, 5)]);
	});

	// Reading order decides who gets a row, so a panel dropped above another
	// takes the higher slot even though it is later in the array.
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

	// A drag in progress must not have the panel tugged out from under the
	// pointer while everything else rearranges beneath it.
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
