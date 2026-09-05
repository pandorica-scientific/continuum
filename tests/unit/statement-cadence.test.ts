// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { cadenceOf, type CoverageBox } from '$lib/statements/coverage';

const box = (state: CoverageBox['state'], months: number): CoverageBox =>
	({ state, startMonth: 0, months, documentIds: [] }) as CoverageBox;

describe("an account's statement cadence", () => {
	it('is the band width that occurs most', () => {
		expect(cadenceOf([box('filed', 1), box('filed', 1), box('gap', 1)])).toBe('monthly');
		expect(cadenceOf([box('filed', 3), box('filed', 3), box('filed', 1)])).toBe('quarterly');
	});
	it('names nothing for an account with nothing filed', () => {
		expect(cadenceOf([box('gap', 1), box('not-arrived', 1)])).toBeNull();
	});
	it('reads the yearly band as yearly', () => {
		expect(cadenceOf([box('filed', 1)], 'yearly')).toBe('yearly');
	});
});
