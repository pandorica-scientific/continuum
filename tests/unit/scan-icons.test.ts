// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { ICONS } from '$lib/icons';

const ADDED = ['camera', 'bolt', 'rotate', 'grip', 'check', 'arrowUp', 'arrowDown'] as const;

describe('the scan icons', () => {
	it('are all present', () => {
		expect(ADDED.filter((name) => !(name in ICONS))).toEqual([]);
	});

	it('keeps every typed primitive inside the 24 viewBox', () => {
		// Only circle/line/rect are checked — a `path` string mixes coordinates with
		// flags, so scanning it for numbers can't tell a coordinate from a sweep flag.
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
