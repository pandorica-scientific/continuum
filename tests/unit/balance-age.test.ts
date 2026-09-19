// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { balanceAge, balanceAgeLabel } from '$lib/statements/balance-age';

describe('how old a shown balance is', () => {
	it('says nothing for an account that has never had a statement', () => {
		// Nothing is being shown, so nothing is out of date.
		expect(balanceAge(null, '2026-09-17')).toBeNull();
	});

	it('leaves a figure from the last few days alone', () => {
		// A statement lands after the period it covers, so a couple of days
		// behind is every statement there has ever been.
		expect(balanceAge('2026-09-15', '2026-09-17')).toEqual({ days: 2, stale: false });
		expect(balanceAge('2026-09-10', '2026-09-17')).toEqual({ days: 7, stale: false });
	});

	it('marks last month closing balance as old', () => {
		// The case that started this: a correct ČS balance for 31 August read as
		// a wrong one on 17 September, because nothing said which day it was true
		// for beyond small grey text.
		expect(balanceAge('2026-08-31', '2026-09-17')).toEqual({ days: 17, stale: true });
	});

	it('treats a figure dated today or later as current', () => {
		expect(balanceAge('2026-09-17', '2026-09-17')).toEqual({ days: 0, stale: false });
		expect(balanceAge('2026-09-20', '2026-09-17')).toEqual({ days: 0, stale: false });
	});

	it('writes the age the way it would be said', () => {
		expect(balanceAgeLabel({ days: 1, stale: false })).toBe('yesterday');
		expect(balanceAgeLabel({ days: 17, stale: true })).toBe('17 days old');
	});
});
