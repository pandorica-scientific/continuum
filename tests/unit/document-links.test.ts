// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { linkDiff } from '$lib/documents/links';

// Guards against a save deleting every link and re-inserting only what the
// form knew about, which used to drop links of kinds the form didn't post.
describe('linkDiff', () => {
	it('leaves an unchanged set alone', () => {
		expect(linkDiff(['a', 'b'], ['a', 'b'])).toEqual({ remove: [], add: [] });
	});

	it('ignores the order the two sides arrive in', () => {
		expect(linkDiff(['a', 'b'], ['b', 'a'])).toEqual({ remove: [], add: [] });
	});

	it('adds what the form asked for and the document does not have', () => {
		expect(linkDiff(['a'], ['a', 'b'])).toEqual({ remove: [], add: ['b'] });
	});

	it('removes only what the form left out', () => {
		// `c` was never on the form, so it is untouched by a save that changed `b`.
		expect(linkDiff(['a', 'b', 'c'], ['a', 'c'])).toEqual({ remove: ['b'], add: [] });
	});

	it('removes a link the form left out — that is what unticking means', () => {
		expect(linkDiff(['a'], [])).toEqual({ remove: ['a'], add: [] });
	});

	it('adds every link when the document had none', () => {
		expect(linkDiff([], ['a', 'b'])).toEqual({ remove: [], add: ['a', 'b'] });
	});

	it('does both at once', () => {
		expect(linkDiff(['a', 'b'], ['b', 'c'])).toEqual({ remove: ['a'], add: ['c'] });
	});

	it('says each id once, however often it was posted', () => {
		// A duplicate insert would be a primary-key violation, so it is deduped here.
		expect(linkDiff(['a', 'a'], ['b', 'b', 'b'])).toEqual({ remove: ['a'], add: ['b'] });
	});

	it('keeps the order each side was given in', () => {
		// Not required by the database, but a diff that reorders its own output
		// makes a failing assertion read as a bug where there is none.
		expect(linkDiff(['c', 'a', 'b'], ['z', 'y'])).toEqual({
			remove: ['c', 'a', 'b'],
			add: ['z', 'y']
		});
	});
});
