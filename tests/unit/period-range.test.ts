// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { periodRange } from '$lib/server/cashflow';

const TODAY = new Date('2026-08-20T12:00:00.000Z');

describe('periodRange', () => {
	it('anchors a month window on the newest month with data, not on today', () => {
		const range = periodRange('month', '2026-07', TODAY);
		expect(range.start).toBe('2026-07-01');
		expect(range.end).toBe('2026-07-31');
		expect(range.caption).toBe('July 2026');
	});

	it('anchors the year-to-date window on the same month', () => {
		// Otherwise the caption claims a window running to August while the
		// figures stop in July, which is the same lie in a different place.
		const range = periodRange('ytd', '2026-07', TODAY);
		expect(range.start).toBe('2026-01-01');
		expect(range.end).toBe('2026-07-31');
		expect(range.caption).toBe('January – July 2026');
	});

	it('falls back to today when the instance holds no transactions', () => {
		const range = periodRange('month', null, TODAY);
		expect(range.start).toBe('2026-08-01');
		expect(range.end).toBe('2026-08-31');
	});

	it('handles an anchor in a previous year', () => {
		const range = periodRange('ytd', '2025-11', TODAY);
		expect(range.start).toBe('2025-01-01');
		expect(range.end).toBe('2025-11-30');
		expect(range.caption).toBe('January – November 2025');
	});

	it('handles February in a leap year', () => {
		const range = periodRange('month', '2024-02', TODAY);
		expect(range.end).toBe('2024-02-29');
	});
});
