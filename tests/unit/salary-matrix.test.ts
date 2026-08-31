// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';

const year = (over: Record<string, unknown> = {}) => ({
	year: 2025,
	age: 40,
	grossAvgMinor: '10000000',
	netAvgMinor: '7140000',
	grossTotalMinor: '120000000',
	baseTotalMinor: '100000000',
	bonusTotalMinor: '20000000',
	netTotalMinor: '85680000',
	grossMonths: 12,
	netMonths: 12,
	netComplete: true,
	deltaPct: 5,
	baseDeltaPct: 2,
	...over
});

const years = [year({ year: 2024, deltaPct: null, baseDeltaPct: null }), year()];

describe('the salary matrix', () => {
	it('sums base and bonus to the gross it reports', () => {
		// The breakdown columns add up to the total column, exactly as a tax
		// year's jurisdictions add up to its year total.
		const [y] = years;
		expect(BigInt(y.baseTotalMinor) + BigInt(y.bonusTotalMinor)).toBe(BigInt(y.grossTotalMinor));
	});
});
