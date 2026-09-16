// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { reach } from '$lib/tags-view';

// `reach` is what the delete confirmation renders ("untags N · M rules stop
// applying it"), pulled out as a pure function because the branch it drives
// only ever shows once a person has clicked delete — a static server render
// can't reach that state.
describe('reach', () => {
	it('counts every carrier the delete removes, not just the headline "tagged" figure', () => {
		// tagged/transactions/splitLines/rules don't all show up in `tagged`, but
		// the delete removes every tag_link row, and the confirmation must say so.
		expect(reach({ tagged: 1, transactions: 2, splitLines: 1, rules: 0 })).toBe('untags 4');
	});

	it('says "untags nothing" rather than going blank when there is nothing to untag', () => {
		// Regression: an `if (t.tagged > 0)` gate silently rendered no text for a
		// tag carried only by a transaction or split, even though delete removes it.
		expect(reach({ tagged: 0, transactions: 0, splitLines: 0, rules: 0 })).toBe('untags nothing');
	});

	it('keeps the rules clause independent of the untag total', () => {
		expect(reach({ tagged: 0, transactions: 0, splitLines: 0, rules: 2 })).toBe(
			'untags nothing · 2 rules stop applying it'
		);
		expect(reach({ tagged: 3, transactions: 0, splitLines: 0, rules: 1 })).toBe(
			'untags 3 · 1 rule stop applying it'
		);
	});
});
