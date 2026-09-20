// SPDX-License-Identifier: AGPL-3.0-or-later
// A promotion closes the old role the day before the new one starts. Getting
// that day wrong at a month or year boundary would leave a period ending on a
// date that does not exist, or two periods both claiming the handover day —
// which is what makes a payslip land in two lanes at once.
import { describe, expect, it } from 'vitest';
import { dayBefore } from '$lib/dates';

describe('dayBefore', () => {
	it('steps back a day inside a month', () => {
		expect(dayBefore('2026-03-15')).toBe('2026-03-14');
	});

	it('steps back across the start of a month', () => {
		expect(dayBefore('2026-03-01')).toBe('2026-02-28');
	});

	it('knows February in a leap year', () => {
		expect(dayBefore('2024-03-01')).toBe('2024-02-29');
	});

	it('steps back across the start of a year', () => {
		expect(dayBefore('2026-01-01')).toBe('2025-12-31');
	});

	// The clocks go forward on 2026-03-29 in Europe; parsed at local time, that
	// day is 23 hours long and this comes back the same day.
	it('is unmoved by the spring forward', () => {
		expect(dayBefore('2026-03-30')).toBe('2026-03-29');
		expect(dayBefore('2026-03-29')).toBe('2026-03-28');
	});
});
