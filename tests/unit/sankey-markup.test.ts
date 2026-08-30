// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The chart is read three ways and used to serve only one of them: the tooltip
// opened on hover and nowhere else, the whole diagram announced itself as a
// single unlabelled image, and its ribbons — which say nothing a reader can be
// given — were in the reading order.
//
// Asserted against the template rather than a render, because these are facts
// about the markup the component always emits: a rendered chart has no layout
// at all until a box has been measured, which a test environment never does.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markupIn } from '../svelte-markup';

const PATH = 'src/lib/charts/Sankey.svelte';
const source = readFileSync(PATH, 'utf8');
const markup = markupIn(source);

/**
 * The first opening tag of a kind, attributes and all.
 *
 * Everything-but-`>` is not enough to find where a tag ends here: a Svelte
 * handler is an arrow function, so `>` occurs inside the attribute list as
 * often as it ends it. Only a `>` that is not the second half of an arrow
 * closes the tag.
 */
const tag = (name: string) =>
	markup.match(new RegExp(`<${name}\\b(?:[^>]|(?<==)>)*?(?<!=)>`))?.[0] ?? '';

describe('the Sankey template', () => {
	// A band that leads to rows is a link, so the keyboard reaches it already;
	// what it did not reach was the figure, which only the pointer could open.
	it('opens the tooltip on focus as well as on hover', () => {
		const anchor = tag('a');
		expect(anchor).toContain('onpointerenter=');
		expect(anchor).toContain('onfocus=');
		expect(anchor).toContain('onblur=');
	});

	it('keeps the ribbons out of the reading order', () => {
		const paths = markup.match(/<path\b[\s\S]*?\/>/g) ?? [];
		expect(paths.length).toBeGreaterThan(0);
		for (const path of paths) expect(path).toContain('aria-hidden="true"');
	});

	it('names and describes itself instead of standing as one image', () => {
		const svg = tag('svg');
		expect(svg).not.toContain('role="img"');
		expect(svg).toContain('aria-labelledby=');
		expect(markup).toMatch(/<title\b[^>]*id=/);
		expect(markup).toMatch(/<desc\b[^>]*id=/);
	});
});

describe('the Sankey style block', () => {
	const style = source.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';

	it('paints without a shadow and moves without a transition', () => {
		expect(style.length).toBeGreaterThan(0);
		expect(style).not.toContain('box-shadow');
		expect(style).not.toContain('transition');
	});
});
