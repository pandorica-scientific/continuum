// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';

import { ICONS } from '$lib/icons';

const ADDED = ['camera', 'bolt', 'rotate', 'grip', 'check', 'arrowUp', 'arrowDown'] as const;

describe('the scan icons', () => {
	it('are all present', () => {
		expect(ADDED.filter((name) => !(name in ICONS))).toEqual([]);
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
});
