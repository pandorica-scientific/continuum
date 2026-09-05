// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { stripItems } from '$lib/briefing';

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
