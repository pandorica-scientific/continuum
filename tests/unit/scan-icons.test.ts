// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Icon from '$lib/components/Icon.svelte';
import { ICONS } from '$lib/icons';

const ADDED = ['camera', 'bolt', 'rotate', 'grip', 'check', 'arrowUp', 'arrowDown'] as const;

describe('the scan icons', () => {
	it('are all present', () => {
		expect(ADDED.filter((name) => !(name in ICONS))).toEqual([]);
	});

	it('are authored as typed primitives, never as markup', () => {
		// Primitives rather than raw markup is what lets Icon.svelte render
		// without {@html}, so a typo in a path cannot inject anything.
		for (const name of ADDED) {
			for (const part of ICONS[name]) {
				expect(Object.keys(part).length).toBe(1);
				expect(['path', 'circle', 'rect', 'line']).toContain(Object.keys(part)[0]);
			}
		}
	});

	it('keeps every typed primitive inside the 24 viewBox', () => {
		// Only circle/line/rect are checked. A `path` string mixes absolute
		// coordinates, relative offsets and arc flags — `A1.5 1.5 0 0 1` is a
		// radius, a rotation and two booleans — so scanning it for numbers
		// cannot tell a coordinate from a sweep flag, and a test that pretends
		// otherwise just fails on correct icons.
		const outside: string[] = [];
		for (const name of ADDED) {
			for (const part of ICONS[name]) {
				if ('path' in part) continue;
				const numbers = Object.values(part)[0] as readonly number[];
				if (numbers.some((n) => n < 0 || n > 24)) outside.push(name);
			}
		}
		expect([...new Set(outside)]).toEqual([]);
	});

	it('renders with the shared geometry of the set', () => {
		const { body } = render(Icon, { props: { name: 'camera', label: 'Take a photo' } });
		expect(body).toContain('viewBox="0 0 24 24"');
		expect(body).toContain('stroke="currentColor"');
		expect(body).toContain('stroke-width="1.7"');
		expect(body).toContain('aria-label="Take a photo"');
	});

	it('hides an icon from screen readers when it has no label', () => {
		// Every camera control that is icon-only carries a label; a decorative
		// one must not be announced twice alongside the text beside it.
		const { body } = render(Icon, { props: { name: 'grip' } });
		expect(body).toContain('aria-hidden="true"');
	});
});
