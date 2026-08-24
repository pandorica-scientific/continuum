// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Page from '../../src/routes/(app)/rules/+page.svelte';

vi.mock('$app/state', () => ({
	page: { data: {}, url: new URL('http://localhost/rules') }
}));

const rule = (i: number) => ({
	id: `r${i}`,
	name: `Rule ${i}`,
	enabled: true,
	conditions: ['counterparty contains ACME'],
	category: 'Groceries',
	tags: [],
	provenance: 'learned',
	confidencePct: 90,
	trusted: true,
	startsTrusted: false,
	accepted: 10,
	corrected: i
});

const base = {
	thresholdPct: 80,
	categories: [],
	tags: [],
	accounts: []
};

const dataWith = (n: number) => ({
	...base,
	rules: Array.from({ length: n }, (_, i) => rule(n - i))
});

const propsFor = (n: number) =>
	({ data: dataWith(n), form: null }) as unknown as Record<string, unknown>;

describe('the rules screen', () => {
	it('shows every rule when there are few enough to fit a page', () => {
		const { body } = render(Page, { props: propsFor(4) as never });
		for (let i = 1; i <= 4; i++) expect(body).toContain(`Rule ${i}`);
	});

	it('renders no pager at or below five rules', () => {
		const { body } = render(Page, { props: propsFor(5) as never });
		expect(body).not.toContain('Rules per page');
	});

	it('pages a long list five at a time', () => {
		// A household that has filed for a while grows dozens of these, and the
		// list was every one of them on one screen.
		const { body } = render(Page, { props: propsFor(12) as never });
		expect(body.match(/class="card rule-row/g)).toHaveLength(5);
	});

	it('offers 5, 25 and 50 to a page, five selected, above the rows it sizes', () => {
		const { body } = render(Page, { props: propsFor(12) as never });
		expect(body).toContain('Rules per page');
		// How much to show is decided before reading; which page, after.
		expect(body.indexOf('Rules per page')).toBeLessThan(body.indexOf('Previous page'));
		expect(body).toContain('>50<');
		expect(body).toContain('aria-current="true"');
	});

	it('says which of the rules the page is showing', () => {
		// "1–5 of 12", not a bare page number: the count is the thing worth
		// knowing when you are looking for one rule among many.
		const { body } = render(Page, { props: propsFor(12) as never });
		expect(body).toContain('1–5 of 12');
	});

	it('keeps the most-overridden rules on the first page', () => {
		// The server orders them that way, and paging must not reshuffle it: the
		// rules worth looking at are the ones being corrected.
		const { body } = render(Page, { props: propsFor(12) as never });
		expect(body).toContain('Rule 12');
		expect(body).not.toContain('Rule 6<');
	});

	it('still says so when there are no rules at all', () => {
		const { body } = render(Page, { props: propsFor(0) as never });
		expect(body).toContain('No rules yet');
	});
});
