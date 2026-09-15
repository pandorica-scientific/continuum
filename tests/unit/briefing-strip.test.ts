// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { stripBriefing, stripItems } from '$lib/briefing';

describe('the briefing strip', () => {
	const items = ['a', 'b', 'c', 'd', 'e', 'f'];

	it('gives the last cell of the row to the "more" tile when there is more than a row', () => {
		expect(stripItems(items, 4, false)).toEqual({ shown: ['a', 'b', 'c'], hidden: 3 });
	});

	it('shows a full row with no tile when the row is exactly full', () => {
		expect(stripItems(['a', 'b', 'c', 'd'], 4, false)).toEqual({
			shown: ['a', 'b', 'c', 'd'],
			hidden: 0
		});
	});

	it('shows everything once expanded', () => {
		expect(stripItems(items, 4, true)).toEqual({ shown: items, hidden: 0 });
	});

	it('shows a short list as it is', () => {
		expect(stripItems(['a'], 4, false)).toEqual({ shown: ['a'], hidden: 0 });
	});
});

describe('notes wait behind the tile', () => {
	const d = (k: string) => ({ k, hue: 'yellow' });
	const n = (k: string) => ({ k, hue: 'grey' });
	it('never shows a grey card on the row, and counts it behind the tile', () => {
		const out = stripBriefing([n('note'), d('a'), d('b')], 4, false);
		expect(out.shown.map((i) => i.k)).toEqual(['a', 'b']);
		expect(out.hidden).toBe(1);
	});
	it('lists notes after decisions once expanded', () => {
		const out = stripBriefing([n('note'), d('a')], 4, true);
		expect(out.shown.map((i) => i.k)).toEqual(['a', 'note']);
		expect(out.hidden).toBe(0);
	});
	it('is the plain strip when there are no notes', () => {
		expect(stripBriefing([d('a'), d('b')], 4, false)).toEqual({
			shown: [d('a'), d('b')],
			hidden: 0
		});
	});
});
