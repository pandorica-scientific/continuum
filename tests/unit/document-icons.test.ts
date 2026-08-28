// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from 'svelte/server';
import Icon from '$lib/components/Icon.svelte';
import { ICONS } from '$lib/icons';

const ADDED = ['lock', 'search'] as const;

describe('the documents icons', () => {
	it('are present', () => {
		expect(ADDED.filter((name) => !(name in ICONS))).toEqual([]);
	});

	it('reuses the existing grip for a drag handle rather than adding another', () => {
		// Two handle glyphs that look the same is exactly the near-duplicate this
		// set exists to avoid; `grip` was drawn for the scan flow and is the same
		// six dots a sortable shelf row needs.
		expect('grip' in ICONS).toBe(true);
	});

	it('are authored as typed primitives, never as markup', () => {
		for (const name of ADDED) {
			for (const part of ICONS[name]) {
				expect(Object.keys(part).length).toBe(1);
				expect(['path', 'circle', 'rect', 'line']).toContain(Object.keys(part)[0]);
			}
		}
	});

	it('keeps every typed primitive inside the 24 viewBox', () => {
		for (const name of ADDED) {
			for (const part of ICONS[name]) {
				const numbers =
					'circle' in part
						? part.circle
						: 'line' in part
							? part.line
							: 'rect' in part
								? part.rect
								: [];
				for (const value of numbers) expect(value).toBeLessThanOrEqual(24);
			}
		}
	});

	it('renders through the shared geometry', () => {
		const { body } = render(Icon, { props: { name: 'lock', size: 13 } });
		expect(body).toContain('stroke-width="1.7"');
		expect(body).toContain('viewBox="0 0 24 24"');
		expect(body).toContain('width="13"');
	});
});

describe('SnippetMark', () => {
	it('marks the term and nothing around it', () => {
		const source = readFileSync(resolve('src/lib/components/SnippetMark.svelte'), 'utf8');
		// A border would read as a pill, and pills mean state here — one word in
		// a snippet matched, the row is not in a state.
		expect(source).not.toMatch(/border\s*:/);
		expect(source).toContain('var(--yellow-tint)');
		// The ink is the darkest ramp step on purpose: if light-theme contrast
		// ever fails, the ink darkens and the tint is left alone.
		expect(source).toContain('var(--fg1)');
		expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/);
	});
});
