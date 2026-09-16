// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { isStale } from '$lib/prices';
import { DEFAULT_PRICE_SETTINGS } from '$lib/server/prices/settings';

describe('isStale', () => {
	it('is stale with no price, or one older than the configured days', () => {
		expect(isStale(null, '2026-09-15', 7)).toBe(true);
		expect(isStale('2026-09-01', '2026-09-15', 7)).toBe(true);
		expect(isStale('2026-09-10', '2026-09-15', 7)).toBe(false);
		expect(isStale('2026-09-15', '2026-09-15', 0)).toBe(false);
	});
});

describe('price settings', () => {
	it('defaults to a daily refresh and a week of tolerance', () => {
		expect(DEFAULT_PRICE_SETTINGS).toEqual({ refreshEveryHours: 24, staleAfterDays: 7 });
	});
});
