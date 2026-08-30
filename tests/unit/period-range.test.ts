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

	it('runs the trailing year to the anchor, the anchor month included', () => {
		// Twelve months, not thirteen: a window that started in July 2025 and ran
		// to July 2026 would compare a month against itself a year later and call
		// the difference a trend.
		const range = periodRange('12m', '2026-07', TODAY);
		expect(range.start).toBe('2025-08-01');
		expect(range.end).toBe('2026-07-31');
		expect(range.caption).toBe('August 2025 – July 2026');
	});

	it('carries the trailing year back over a year boundary', () => {
		const range = periodRange('12m', '2026-01', TODAY);
		expect(range.start).toBe('2025-02-01');
		expect(range.end).toBe('2026-01-31');
		expect(range.caption).toBe('February 2025 – January 2026');
	});

	it('ends the trailing year on the 29th of a leap February', () => {
		const range = periodRange('12m', '2024-02', TODAY);
		expect(range.start).toBe('2023-03-01');
		expect(range.end).toBe('2024-02-29');
	});
});
