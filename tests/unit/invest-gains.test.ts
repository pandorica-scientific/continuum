// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_GAINS_POLICY,
	parseGainsPolicy,
	realisedGains,
	yearsHeld,
	type ClosedPosition
} from '$lib/invest/gains';

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

const position = (over: Partial<ClosedPosition> = {}): ClosedPosition => ({
	purchaseValueMinor: 100_000n,
	saleValueMinor: 150_000n,
	openedAt: at('2026-01-10'),
	closedAt: at('2026-06-10'),
	...over
});

const FLAT = { ratePct: 15, exemptLongHeld: false, exemptAfterYears: 3 };
const WITH_TIME_TEST = { ratePct: 15, exemptLongHeld: true, exemptAfterYears: 3 };

describe('yearsHeld', () => {
	it('counts whole years by the calendar, not by 365 days', () => {
		expect(yearsHeld(at('2023-06-10'), at('2026-06-10'))).toBe(3);
		// One day short of the anniversary is still two years, which is the whole
		// point of a time test.
		expect(yearsHeld(at('2023-06-10'), at('2026-06-09'))).toBe(2);
		expect(yearsHeld(at('2023-06-10'), at('2026-06-11'))).toBe(3);
	});

	it('handles a leap-day purchase without inventing a year', () => {
		expect(yearsHeld(at('2024-02-29'), at('2027-02-28'))).toBe(2);
		expect(yearsHeld(at('2024-02-29'), at('2027-03-01'))).toBe(3);
	});
});

describe('realisedGains', () => {
	it('nets gains and losses realised in the year', () => {
		const result = realisedGains(
			[
				position({ purchaseValueMinor: 100_000n, saleValueMinor: 150_000n }),
				position({ purchaseValueMinor: 200_000n, saleValueMinor: 180_000n })
			],
			2026,
			FLAT
		);
		expect(result.realisedMinor).toBe(30_000n);
		expect(result.disposals).toBe(2);
		expect(result.taxableMinor).toBe(30_000n);
		expect(result.estimatedTaxMinor).toBe(4_500n);
	});

	it('ignores positions closed in another year, and ones still open', () => {
		const result = realisedGains(
			[
				position({ closedAt: at('2025-06-10') }),
				position({ closedAt: null }),
				position({ saleValueMinor: null })
			],
			2026,
			FLAT
		);
		expect(result.disposals).toBe(0);
		expect(result.realisedMinor).toBe(0n);
	});

	// A loss is not a negative tax bill. What a loss really does — offsetting
	// other gains, carrying forward — is a question about somebody's whole
	// return, which this cannot see.
	it('never reports a negative tax', () => {
		const result = realisedGains(
			[position({ purchaseValueMinor: 200_000n, saleValueMinor: 100_000n })],
			2026,
			FLAT
		);
		expect(result.realisedMinor).toBe(-100_000n);
		expect(result.taxableMinor).toBe(0n);
		expect(result.estimatedTaxMinor).toBe(0n);
	});

	it('leaves everything taxable when the exemption is off', () => {
		const held = [position({ openedAt: at('2020-01-01'), closedAt: at('2026-06-10') })];
		const result = realisedGains(held, 2026, FLAT);
		expect(result.exemptMinor).toBe(0n);
		expect(result.taxableMinor).toBe(50_000n);
	});

	// Off by default and configurable, because a three-year time test is a fact
	// about one country rather than about investing.
	it('excludes a long-held disposal when the exemption is on', () => {
		const result = realisedGains(
			[
				position({ openedAt: at('2020-01-01'), closedAt: at('2026-06-10') }),
				position({ openedAt: at('2025-01-01'), closedAt: at('2026-06-10') })
			],
			2026,
			WITH_TIME_TEST
		);
		expect(result.disposals).toBe(2);
		expect(result.exemptDisposals).toBe(1);
		expect(result.exemptMinor).toBe(50_000n);
		expect(result.taxableMinor).toBe(50_000n);
		expect(result.estimatedTaxMinor).toBe(7_500n);
	});

	it('honours a threshold other than three years', () => {
		const five = { ratePct: 15, exemptLongHeld: true, exemptAfterYears: 5 };
		const result = realisedGains(
			[position({ openedAt: at('2022-01-01'), closedAt: at('2026-06-10') })],
			2026,
			five
		);
		expect(result.exemptDisposals).toBe(0);
		expect(result.taxableMinor).toBe(50_000n);
	});

	it('rounds the tax on the minor unit rather than carrying a fraction', () => {
		// 15% of 333 minor units is 49.95 — the stored figure must be an integer.
		const result = realisedGains(
			[position({ purchaseValueMinor: 0n, saleValueMinor: 333n })],
			2026,
			FLAT
		);
		expect(result.estimatedTaxMinor).toBe(50n);
	});

	it('reports nothing at all rather than zero tax on no data', () => {
		const result = realisedGains([], 2026, FLAT);
		expect(result).toMatchObject({
			realisedMinor: 0n,
			taxableMinor: 0n,
			estimatedTaxMinor: 0n,
			disposals: 0
		});
	});
});

describe('parseGainsPolicy', () => {
	const form = (over: Partial<Parameters<typeof parseGainsPolicy>[0]> = {}) => ({
		ratePct: '15',
		exemptLongHeld: false,
		exemptAfterYears: '3',
		...over
	});

	it('reads a rate and a threshold', () => {
		expect(parseGainsPolicy(form())).toEqual({
			policy: { ratePct: 15, exemptLongHeld: false, exemptAfterYears: 3 }
		});
	});

	it('accepts a comma as the decimal separator', () => {
		expect(parseGainsPolicy(form({ ratePct: '12,5' }))).toEqual({
			policy: { ratePct: 12.5, exemptLongHeld: false, exemptAfterYears: 3 }
		});
	});

	// The reported fault: the threshold field is disabled while the exemption is
	// off, a disabled field is not posted, and rejecting its absence threw away
	// the rate typed beside it.
	it('keeps the stored threshold when the field was not posted', () => {
		expect(
			parseGainsPolicy(form({ exemptAfterYears: null, exemptLongHeld: true }), {
				ratePct: 0,
				exemptLongHeld: false,
				exemptAfterYears: 5
			})
		).toEqual({ policy: { ratePct: 15, exemptLongHeld: true, exemptAfterYears: 5 } });
	});

	it('falls back to the default threshold when nothing is stored yet', () => {
		expect(parseGainsPolicy(form({ exemptAfterYears: '' }))).toEqual({
			policy: {
				ratePct: 15,
				exemptLongHeld: false,
				exemptAfterYears: DEFAULT_GAINS_POLICY.exemptAfterYears
			}
		});
	});

	it('reads a blank rate as untaxed rather than refusing it', () => {
		expect(parseGainsPolicy(form({ ratePct: '' }))).toEqual({
			policy: { ratePct: 0, exemptLongHeld: false, exemptAfterYears: 3 }
		});
	});

	it('refuses a rate outside 0–100 and a threshold that is not whole years', () => {
		expect(parseGainsPolicy(form({ ratePct: '101' }))).toEqual({
			message: 'The rate must be a percentage between 0 and 100.'
		});
		expect(parseGainsPolicy(form({ ratePct: 'lots' }))).toEqual({
			message: 'The rate must be a percentage between 0 and 100.'
		});
		expect(parseGainsPolicy(form({ exemptAfterYears: '2.5' }))).toEqual({
			message: 'The exemption threshold must be a whole number of years.'
		});
		expect(parseGainsPolicy(form({ exemptAfterYears: '0' }))).toEqual({
			message: 'The exemption threshold must be a whole number of years.'
		});
	});
});
