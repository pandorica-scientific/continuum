// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { blendedRatePct, flaggedThresholdMinor, taxByYear } from '$lib/tax';

// A deliberately lopsided table, so a wrong day silently using another year's
// rate shows up as a wrong number rather than the same number.
const RATES: Record<string, number> = {
	'CZK|2024-12-31': 0.04,
	'CZK|2025-12-31': 0.05,
	'PLN|2025-12-31': 0.23,
	'PLN|2024-12-31': 0.23,
	'EUR|2018-12-31': 1,
	'EUR|2024-12-31': 1,
	'EUR|2025-12-31': 1
};

const convert = (amount: bigint, from: string, to: string, day: string): bigint => {
	if (from === to) return amount;
	const rate = RATES[`${from}|${day}`];
	if (rate === undefined) throw new Error(`no rate for ${from} on ${day}`);
	return BigInt(Math.round(Number(amount) * rate));
};

const statement = (
	year: number,
	country: string,
	currency: string,
	gross: bigint,
	tax: bigint,
	personId = 'p1'
) => ({
	personId,
	personName: personId === 'p1' ? 'Robert' : 'Jana',
	year,
	country,
	currency,
	grossIncomeMinor: gross,
	taxPaidMinor: tax
});

describe('taxByYear', () => {
	it('returns years ascending, because the chart reads left to right', () => {
		const rows = taxByYear(
			[
				statement(2025, 'CZ', 'CZK', 1000n, 100n),
				statement(2018, 'CZ', 'CZK', 800n, 80n),
				statement(2024, 'CZ', 'CZK', 900n, 90n)
			],
			'CZK',
			convert
		);
		expect(rows.map((r) => r.year)).toEqual([2018, 2024, 2025]);
	});

	it('converts at year end, so an old filing does not move when rates do', () => {
		const rows = taxByYear([statement(2024, 'CZ', 'CZK', 1_000_000n, 0n)], 'EUR', convert);
		// 2024's rate, not 2025's. 1 000 000 × 0.04 = 40 000.
		expect(rows[0].grossMinor).toBe(40_000n);
	});

	it('sums two jurisdictions into one year total', () => {
		const rows = taxByYear(
			[
				statement(2025, 'CZ', 'CZK', 1_000_000n, 150_000n),
				statement(2025, 'PL', 'PLN', 100_000n, 20_000n)
			],
			'EUR',
			convert
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].byCountry.map((c) => c.country)).toEqual(['CZ', 'PL']);
		// 1 000 000 × 0.05 + 100 000 × 0.23 = 50 000 + 23 000
		expect(rows[0].grossMinor).toBe(73_000n);
		// 150 000 × 0.05 + 20 000 × 0.23 = 7 500 + 4 600
		expect(rows[0].taxMinor).toBe(12_100n);
	});

	it('keeps the filed figures native, untouched by the display currency', () => {
		const rows = taxByYear([statement(2025, 'CZ', 'CZK', 1_000_000n, 150_000n)], 'EUR', convert);
		expect(rows[0].byCountry[0].native).toEqual([
			{ currency: 'CZK', grossMinor: 1_000_000n, taxMinor: 150_000n }
		]);
	});

	it('merges two statements in one country and year rather than showing two columns', () => {
		const rows = taxByYear(
			[
				statement(2025, 'CZ', 'CZK', 1_000_000n, 100_000n, 'p1'),
				statement(2025, 'CZ', 'CZK', 500_000n, 50_000n, 'p2')
			],
			'CZK',
			convert
		);
		expect(rows[0].byCountry).toHaveLength(1);
		expect(rows[0].byCountry[0].grossMinor).toBe(1_500_000n);
		// Both filings stay visible in the native list — the expansion shows them
		// separately even though the cell adds them up.
		expect(rows[0].byCountry[0].native).toHaveLength(2);
	});

	it('filters to one person when asked', () => {
		const rows = taxByYear(
			[
				statement(2025, 'CZ', 'CZK', 1_000_000n, 100_000n, 'p1'),
				statement(2025, 'CZ', 'CZK', 500_000n, 50_000n, 'p2')
			],
			'CZK',
			convert,
			'p2'
		);
		expect(rows[0].byCountry[0].grossMinor).toBe(500_000n);
	});

	it('drops a year entirely when the filtered person did not file in it', () => {
		// Not a row of empty cells: that person has no 2024, and a blank row
		// asserts they earned nothing rather than that they were not there.
		const rows = taxByYear(
			[
				statement(2024, 'CZ', 'CZK', 1_000_000n, 100_000n, 'p1'),
				statement(2025, 'CZ', 'CZK', 500_000n, 50_000n, 'p2')
			],
			'CZK',
			convert,
			'p2'
		);
		expect(rows.map((r) => r.year)).toEqual([2025]);
	});

	it('sorts jurisdictions within a year, so columns do not jump between loads', () => {
		const rows = taxByYear(
			[statement(2025, 'PL', 'PLN', 100_000n, 0n), statement(2025, 'CZ', 'CZK', 1_000_000n, 0n)],
			'EUR',
			convert
		);
		expect(rows[0].byCountry.map((c) => c.country)).toEqual(['CZ', 'PL']);
	});

	it('gives a year with no gross a null rate rather than zero', () => {
		const rows = taxByYear([statement(2025, 'CZ', 'CZK', 0n, 0n)], 'CZK', convert);
		expect(rows[0].ratePct).toBeNull();
	});

	it('returns nothing for no statements rather than a row of zeroes', () => {
		expect(taxByYear([], 'EUR', convert)).toEqual([]);
	});
});

describe('blendedRatePct', () => {
	it('weights by income rather than averaging the yearly rates', () => {
		// €1 000 at 1% and €100 000 at 20%. A mean of the two rates says 10.5%;
		// weighted by income it is 19.81%, which is what was actually paid.
		const rows = taxByYear(
			[
				statement(2018, 'CZ', 'EUR', 100_000n, 1_000n),
				statement(2025, 'CZ', 'EUR', 10_000_000n, 2_000_000n)
			],
			'EUR',
			convert
		);
		expect(blendedRatePct(rows)).toBeCloseTo(19.81, 1);
	});

	it('is null when nothing was earned', () => {
		expect(blendedRatePct([])).toBeNull();
	});
});

describe('flaggedThresholdMinor', () => {
	it('sits below the median filing, so an outlier two orders down is caught', () => {
		// The shape of the real record: two large filings and one tiny one.
		const rows = taxByYear(
			[
				statement(2023, 'CZ', 'EUR', 4_000_000n, 0n),
				statement(2024, 'CZ', 'EUR', 4_000_000n, 0n),
				statement(2025, 'PL', 'EUR', 8_500n, 0n)
			],
			'EUR',
			convert
		);
		const threshold = flaggedThresholdMinor(rows);
		expect(8_500n < threshold).toBe(true);
		expect(4_000_000n < threshold).toBe(false);
	});

	it('flags nothing when every filing is the same size', () => {
		const rows = taxByYear(
			[statement(2024, 'CZ', 'EUR', 1000n, 0n), statement(2025, 'CZ', 'EUR', 1000n, 0n)],
			'EUR',
			convert
		);
		expect(1000n < flaggedThresholdMinor(rows)).toBe(false);
	});

	it('uses the median so one outlier cannot lower the bar meant to catch it', () => {
		// With a mean, enough tiny filings drag the threshold down until none of
		// them is flagged any more — which is the wrong way round.
		const rows = taxByYear(
			[
				statement(2021, 'CZ', 'EUR', 4_000_000n, 0n),
				statement(2022, 'CZ', 'EUR', 4_000_000n, 0n),
				statement(2023, 'CZ', 'EUR', 4_000_000n, 0n),
				statement(2024, 'PL', 'EUR', 100n, 0n),
				statement(2025, 'PL', 'EUR', 100n, 0n)
			],
			'EUR',
			convert
		);
		expect(100n < flaggedThresholdMinor(rows)).toBe(true);
	});

	it('returns zero for an empty record, so nothing is flagged', () => {
		expect(flaggedThresholdMinor([])).toBe(0n);
	});
});
