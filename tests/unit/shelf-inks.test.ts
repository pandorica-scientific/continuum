// SPDX-License-Identifier: AGPL-3.0-or-later
// A shelf's colour is an identifier, so two shelves must not share a token
// while one is free, and the first few must be distinguishable by eye.
import { describe, expect, it } from 'vitest';
import { inkForShelf } from '$lib/server/life/recipes';
import { RESERVE_COLOR_TOKENS } from '$lib/categories';

describe('inkForShelf', () => {
	it('gives the first four shelves four colours nobody would confuse', () => {
		const taken: string[] = [];
		for (let at = 0; at < 4; at++) taken.push(inkForShelf(taken));
		// r1, r3, r5, r7: a green, an indigo, a cyan and a purple — picking by
		// rank order alone can yield two greens.
		expect(taken).toEqual(['--series-r1', '--series-r3', '--series-r5', '--series-r7']);
	});

	it('never repeats while a token is still free', () => {
		const taken: string[] = [];
		for (let at = 0; at < RESERVE_COLOR_TOKENS.length; at++) taken.push(inkForShelf(taken));
		expect(new Set(taken).size).toBe(RESERVE_COLOR_TOKENS.length);
		expect([...taken].sort()).toEqual([...RESERVE_COLOR_TOKENS].sort());
	});

	it('starts the list again once every token is worn', () => {
		const all = [...RESERVE_COLOR_TOKENS];
		// Past the tenth shelf a colour is repeated on purpose: the name is doing
		// the work by then, and refusing to make the shelf would be worse.
		expect(RESERVE_COLOR_TOKENS).toContain(inkForShelf(all));
	});

	it('fills a gap left by a shelf that was taken away', () => {
		const taken = ['--series-r1', '--series-r5'];
		expect(inkForShelf(taken)).toBe('--series-r3');
	});
});
