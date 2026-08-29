// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { linkDiff } from '$lib/document-links';

/**
 * The arithmetic behind a save that must not destroy what it could not see.
 *
 * The inspector used to delete every link a document had and re-insert what the
 * form posted, and the form only knew about three kinds — so opening a receipt
 * and pressing Save threw away the transaction it evidenced. What replaces it
 * is this subtraction, and the subtraction is where the mistake would live.
 */
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
		// The whole point: `c` was never on the form, so it is not touched by a
		// save that changed `b` — unless it was left out on purpose, which is the
		// next test.
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
		// A chip and its hidden input could both name the same link. An insert of
		// the pair twice is a primary-key violation, so the duplicate is dropped
		// here rather than left to `onConflictDoNothing` to swallow.
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
