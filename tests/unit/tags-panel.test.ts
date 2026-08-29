// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * The Tags panel, rendered to a string the way `documents-card.test.ts` does —
 * there is no browser suite here, so what is asserted is what a screen depends
 * on: that a tagged loan shows up with a way to reach it, and that a tag used
 * only on a transaction split says so rather than rendering as if it were
 * unused.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TagsPanel from '$lib/components/TagsPanel.svelte';
import { reach } from '$lib/tags-view';
import type { TagsScreen } from '$lib/server/tags/screen';

type TagRow = TagsScreen['tags'][number];

const tag = (over: Partial<TagRow> = {}): TagRow => ({
	id: 't1',
	name: 'Renovation',
	tagged: 0,
	rules: 0,
	transactions: 0,
	splitLines: 0,
	documents: [],
	documentsMore: 0,
	properties: [],
	propertiesMore: 0,
	loans: [],
	loansMore: 0,
	parts: [],
	converted: '0.00 CZK',
	mixed: false,
	empty: true,
	...over
});

const screen = (tags: TagRow[]): TagsScreen => ({ baseCurrency: 'CZK', tags });

describe('the tags panel', () => {
	it('lists a tagged loan with a link to the loans screen', () => {
		const { body } = render(TagsPanel, {
			props: {
				screen: screen([tag({ loans: [{ id: 'l1', name: 'Family mortgage' }], tagged: 1 })])
			}
		});
		expect(body).toContain('Family mortgage');
		expect(body).toContain('href="/loans"');
	});

	it('shows a split-only tag as a line count rather than an empty row', () => {
		const { body } = render(TagsPanel, {
			props: { screen: screen([tag({ splitLines: 3 })]) }
		});
		expect(body).toContain('+3 on transaction lines');
	});

	it('says nothing about loans or split lines when there are none', () => {
		const { body } = render(TagsPanel, {
			props: { screen: screen([tag()]) }
		});
		expect(body).not.toContain('href="/loans"');
		expect(body).not.toContain('on transaction lines');
	});

	// A tag applied only to whole transactions has no card in the item list
	// either — the same reason a split-only tag gets "+n on transaction lines"
	// rather than vanishing.
	it('shows a hint for tags carried only by whole transactions', () => {
		const { body } = render(TagsPanel, {
			props: { screen: screen([tag({ transactions: 2 })]) }
		});
		expect(body).toContain('+2 on transactions');
	});
});

// `reach` is what the delete confirmation renders ("untags N · M rules stop
// applying it"). Pulled out as a pure function, the way `documentExpiryTone`
// is, because the branch it drives only ever shows once a person has clicked
// the delete button — a static server render can't reach that state, so the
// computation is tested directly rather than through markup.
describe('reach', () => {
	it('counts every carrier the delete removes, not just the headline "tagged" figure', () => {
		// One listed document (`tagged`), two whole-transaction tags and one
		// split tag — none of the last two show up in `tagged`, but the delete
		// removes all four tag_link rows, and the confirmation has to say so.
		expect(reach({ tagged: 1, transactions: 2, splitLines: 1, rules: 0 })).toBe('untags 4');
	});

	it('says "untags nothing" rather than going blank when there is nothing to untag', () => {
		// The old `if (t.tagged > 0)` gate meant a tag carried only by a
		// transaction or a split rendered no confirmation text at all — silent,
		// even though `deleteTag` still removes every tag_link it has.
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
