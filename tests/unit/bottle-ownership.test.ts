// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The four rules that keep a cellar's counts true.
 *
 * These are the load-bearing part of the Cellar. The CHECK constraint on
 * `bottle` is what happens when they are wrong — so they are written first, and
 * the numbers are never clamped for display, because a clamp hides the bug it
 * is covering.
 */
import { describe, expect, it } from 'vitest';
import { add, openOne, remove, stateOf } from '$lib/life/collections/ownership';

describe('adding a bottle', () => {
	it('adds a sealed one', () => {
		expect(add({ owned: 2, opened: 1 })).toEqual({ owned: 3, opened: 1 });
	});

	// Buying another bottle does not open it.
	it('never changes the open count', () => {
		expect(add({ owned: 0, opened: 0 }).opened).toBe(0);
		expect(add({ owned: 5, opened: 5 }).opened).toBe(5);
	});
});

describe('removing a bottle', () => {
	// The open one is the one that gets finished.
	it('takes the open one first', () => {
		expect(remove({ owned: 3, opened: 1 })).toEqual({ owned: 2, opened: 0 });
	});

	it('only drops the sealed count once nothing is open', () => {
		expect(remove({ owned: 3, opened: 0 })).toEqual({ owned: 2, opened: 0 });
	});

	it('goes no further than empty', () => {
		expect(remove({ owned: 0, opened: 0 })).toEqual({ owned: 0, opened: 0 });
	});

	it('leaves an all-open cellar consistent', () => {
		expect(remove({ owned: 2, opened: 2 })).toEqual({ owned: 1, opened: 1 });
	});
});

describe('opening one', () => {
	it('is the only control that raises the open count', () => {
		expect(openOne({ owned: 3, opened: 0 })).toEqual({ owned: 3, opened: 1 });
	});

	// The CHECK is `opened <= owned`, and this is what keeps it true.
	it('cannot open more than is owned', () => {
		expect(openOne({ owned: 2, opened: 2 })).toEqual({ owned: 2, opened: 2 });
		expect(openOne({ owned: 0, opened: 0 })).toEqual({ owned: 0, opened: 0 });
	});
});

describe('what the counts say', () => {
	it('reads finished at nothing owned', () => {
		expect(stateOf({ owned: 0, opened: 0 })).toEqual({ kind: 'finished', label: 'Finished' });
	});

	it('reads plainly at one', () => {
		expect(stateOf({ owned: 1, opened: 0 })).toEqual({ kind: 'sealed', label: 'Sealed' });
		expect(stateOf({ owned: 1, opened: 1 })).toEqual({ kind: 'open', label: 'Open' });
	});

	// Above one the two numbers are both worth saying.
	it('splits above one', () => {
		expect(stateOf({ owned: 4, opened: 1 })).toEqual({
			kind: 'some-open',
			label: '3 sealed, 1 open'
		});
		expect(stateOf({ owned: 3, opened: 0 })).toEqual({ kind: 'sealed', label: '3 sealed' });
		expect(stateOf({ owned: 2, opened: 2 })).toEqual({ kind: 'open', label: '2 open' });
	});

	// Not clamped: if the database ever holds this, the screen says so rather
	// than quietly rendering something plausible.
	it('says so when the numbers are impossible', () => {
		expect(stateOf({ owned: 1, opened: 3 })).toEqual({ kind: 'impossible', label: '3 open of 1' });
	});
});
