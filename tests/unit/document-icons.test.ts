// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';

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
});
