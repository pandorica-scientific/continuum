// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { pathRibbons, ribbonRoute, type SankeyRibbon } from '../../src/lib/charts/sankey';

/** Only the two fields the walk reads; the geometry is irrelevant to it. */
function link(from: string, to: string): SankeyRibbon {
	return {
		from,
		to,
		value: 1,
		x0: 0,
		y0: 0,
		x1: 1,
		y1: 1,
		thickness: 1,
		colorVar: '--teal',
		d: ''
	};
}

describe('lighting a path through the Sankey', () => {
	// salary → in → bills → rent, plus a second branch that must stay dark.
	const ribbons = [
		link('salary', 'in'),
		link('in', 'bills'),
		link('bills', 'rent'),
		link('other', 'elsewhere')
	];

	it('lights nothing when the pointer is on nothing', () => {
		expect(pathRibbons(ribbons, null).size).toBe(0);
	});

	it('follows the route upstream AND downstream from the block', () => {
		// Standing on `bills`: the salary two columns left is on the same route.
		expect([...pathRibbons(ribbons, 'bills')].sort()).toEqual([0, 1, 2]);
	});

	it('leaves a branch that does not reach the block alone', () => {
		expect(pathRibbons(ribbons, 'bills').has(3)).toBe(false);
	});

	it('lights the whole tree from an end', () => {
		expect([...pathRibbons(ribbons, 'salary')].sort()).toEqual([0, 1, 2]);
		expect([...pathRibbons(ribbons, 'rent')].sort()).toEqual([0, 1, 2]);
	});

	it('does not loop forever on a cycle', () => {
		const cyclic = [link('a', 'b'), link('b', 'a')];
		expect(pathRibbons(cyclic, 'a').size).toBe(2);
	});

	it('says nothing about a key that is not in the graph', () => {
		expect(pathRibbons(ribbons, 'nowhere').size).toBe(0);
	});

	it('lights the whole route through a band, both ways', () => {
		// Pointing at in → bills: the salary before it and the rent after it.
		expect([...ribbonRoute(ribbons, 1)].sort()).toEqual([0, 1, 2]);
		expect(ribbonRoute(ribbons, 1).has(3)).toBe(false);
	});

	it('lights nothing for no band, or a band that is not there', () => {
		expect(ribbonRoute(ribbons, null).size).toBe(0);
		expect(ribbonRoute(ribbons, 9).size).toBe(0);
	});
});
