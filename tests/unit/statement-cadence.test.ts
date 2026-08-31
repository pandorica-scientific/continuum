// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { STALE_AFTER_DAYS, staleAfter, statementStatus } from '$lib/statements/cadence';

/** Four uploads on the first of the month: gaps of 30, 31, 30 days. */
const monthly = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'];
/** Four uploads a week apart. */
const weekly = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22'];

describe('staleAfter', () => {
	// Two uploads is one gap, and one gap is an accident rather than a rhythm.
	it('falls back to the fixed window until there are three imports to read', () => {
		expect(staleAfter([])).toBe(STALE_AFTER_DAYS);
		expect(staleAfter(['2026-05-01'])).toBe(STALE_AFTER_DAYS);
		expect(staleAfter(['2026-05-01', '2026-06-01'])).toBe(STALE_AFTER_DAYS);
	});

	// The median rather than the mean: one catch-up upload of a year's backlog
	// is a single enormous gap, and a mean would let it push the threshold out
	// far enough that the account never looks late again.
	it('reads the cadence off the median gap once there are three imports', () => {
		// A month and half again — which is where the fixed default came from.
		expect(staleAfter(monthly)).toBe(45);
		// Seven days and half again. An account read weekly is late in a
		// fortnight, not in the month and a half a fixed default would allow.
		expect(staleAfter(weekly)).toBe(11);
	});
});

describe('statementStatus', () => {
	it('goes stale past the cadence it read, and not before', () => {
		const fresh = statementStatus(monthly, '2026-08-01');
		expect(fresh).toMatchObject({ lastOn: '2026-07-01', daysSince: 31, threshold: 45 });
		expect(fresh.stale).toBe(false);

		const late = statementStatus(monthly, '2026-09-01');
		expect(late.daysSince).toBe(62);
		expect(late.stale).toBe(true);
	});

	// An account nobody has ever imported is not overdue — nothing was promised.
	// The panel says "never" against it, which is a different fact from "late".
	it('has nothing to be late about where nothing was ever imported', () => {
		expect(statementStatus([], '2026-09-01')).toEqual({
			lastOn: null,
			daysSince: null,
			threshold: STALE_AFTER_DAYS,
			stale: false
		});
	});
});
