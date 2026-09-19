// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { LANE_LEGEND, LANE_ORDER, laneRank, laneStyle, reviewLane } from '$lib/import/review-lane';
import { REJECTED_REASON } from '$lib/server/import/transfer-decisions';

describe('which lane a queued row belongs to', () => {
	it('puts a proposed pairing in its own lane whatever else is known', () => {
		// The question on the card is "are these two the same movement", which
		// is not a question about categories, so a suggestion does not outrank it.
		expect(reviewLane({ isTransfer: true, suggestedCategoryId: 'groceries' })).toBe('transfer');
	});

	it('separates a suggestion from nothing at all', () => {
		expect(reviewLane({ suggestedCategoryId: 'pharmacy', reason: 'rule not proven yet' })).toBe(
			'suggested'
		);
		expect(reviewLane({ reason: 'first time seeing this counterparty' })).toBe('unknown');
	});

	it('gives a rule conflict its own lane, whichever categories disagree', () => {
		// The matcher writes the categories into the reason, so the lane cannot
		// be decided by equality.
		expect(reviewLane({ reason: 'rules disagree (food vs household)' })).toBe('conflict');
		expect(reviewLane({ reason: 'rules disagree (a vs b)', suggestedCategoryId: 'a' })).toBe(
			'conflict'
		);
	});

	it('marks a row you sent back yourself as yours, not as unrecognised', () => {
		expect(reviewLane({ reason: 'no longer a transfer — pick a category' })).toBe('returned');
		expect(reviewLane({ reason: 'split removed' })).toBe('returned');
	});

	it('recognises the rejected-pair reason its own module writes', () => {
		// Pinned to the constant rather than to a copy of its text: the lane is
		// decided on an exact string, so a reword there would silently drop
		// these rows into the wrong lane and nothing else would notice.
		expect(reviewLane({ reason: REJECTED_REASON })).toBe('returned');
	});

	it('falls back to "nothing recognised" for a reason it does not know', () => {
		expect(reviewLane({ reason: 'something invented later' })).toBe('unknown');
		expect(reviewLane({})).toBe('unknown');
		expect(reviewLane({ reason: null, suggestedCategoryId: null })).toBe('unknown');
	});

	it('carries a colour and a plain-words label for every lane', () => {
		expect(laneStyle({ isTransfer: true })).toMatchObject({
			lane: 'transfer',
			colour: '--purple'
		});
		expect(laneStyle({ suggestedCategoryId: 'x' }).colour).toBe('--green');
		expect(laneStyle({}).colour).toBe('--yellow');
	});

	it('works transfers first and the unrecognised heap last', () => {
		// The order somebody actually wants to answer them in: two rows resolved
		// by one yes, then the ones that arrive already filled in, then the ones
		// that need thinking about, then the hundreds nobody has seen before.
		const rank = (row: Parameters<typeof laneRank>[0]) => laneRank(row);
		const transfer = rank({ isTransfer: true });
		const suggested = rank({ suggestedCategoryId: 'food' });
		const conflict = rank({ reason: 'rules disagree (a vs b)' });
		const returned = rank({ reason: 'split removed' });
		const unknown = rank({});
		expect(transfer).toBeLessThan(suggested);
		expect(suggested).toBeLessThan(conflict);
		expect(conflict).toBeLessThan(returned);
		expect(returned).toBeLessThan(unknown);
	});

	it('sorts a mixed queue into lane order without disturbing what is inside a lane', () => {
		// Stability is what keeps newest-first inside each lane, which the query
		// already applied. A sort that reshuffled equals would scramble it.
		const rows = [
			{ id: 'y1' },
			{ id: 'g1', suggestedCategoryId: 'food' },
			{ id: 'y2' },
			{ id: 'p1', isTransfer: true },
			{ id: 'g2', suggestedCategoryId: 'fuel' },
			{ id: 'y3' }
		];
		const order = [...rows].sort((a, b) => laneRank(a) - laneRank(b)).map((r) => r.id);
		expect(order).toEqual(['p1', 'g1', 'g2', 'y1', 'y2', 'y3']);
	});

	it('ranks an unknown lane last rather than first', () => {
		// A `reviewLane` that grew a value this map has not got must not sort to
		// the top of the queue by accident.
		expect(laneRank({})).toBe(LANE_ORDER.length - 1);
	});

	it('legends the lanes in the order the queue is worked', () => {
		expect(LANE_LEGEND.map((l) => l.lane)).toEqual([...LANE_ORDER]);
	});

	it('legends every lane exactly once, with no colour used twice', () => {
		const lanes = LANE_LEGEND.map((l) => l.lane);
		expect(new Set(lanes).size).toBe(lanes.length);
		expect(lanes).toHaveLength(5);
		const colours = LANE_LEGEND.map((l) => l.colour);
		expect(new Set(colours).size).toBe(colours.length);
		for (const entry of LANE_LEGEND) expect(entry.label.length).toBeGreaterThan(0);
	});
});
