import { describe, expect, it } from 'vitest';
import { comparisonBars, decodeScenarioPayload, defaultFixationStart } from '$lib/loans/scenario';

describe('decodeScenarioPayload', () => {
	it('converts a serialized scenario into the same minor-unit terms used by both dialogs', () => {
		const decoded = decodeScenarioPayload({
			terms: {
				owedMinor: '123456',
				owedAsOfMonth: '2026-08',
				dayCount: 'actual_365',
				accrualStyle: 'payment',
				paymentDay: 15
			},
			periods: [
				{
					startDate: '2026-01-01',
					endDate: null,
					annualRatePct: 4.2,
					paymentMinor: '22000'
				}
			]
		});

		expect(decoded.terms).toMatchObject({
			owedMinor: 123456n,
			owedAsOfMonth: '2026-08',
			paymentDay: 15
		});
		expect(decoded.periods).toEqual([
			{ startDate: '2026-01-01', endDate: null, annualRatePct: 4.2, paymentMinor: 22000n }
		]);
	});
});

describe('comparisonBars', () => {
	it('uses exact minor-unit values and formatted labels for the shared schedule preview', () => {
		expect(
			comparisonBars([{ year: '2027', interestMinor: 12345n, principalMinor: 67890n }], 'CZK')
		).toEqual([
			{
				year: '2027',
				interest: 12345,
				principal: 67890,
				interestLabel: '123.45',
				principalLabel: '678.90'
			}
		]);
	});
});

describe('defaultFixationStart', () => {
	it('does not rewind an open current period to a historical boundary', () => {
		expect(
			defaultFixationStart(
				[
					{
						startDate: '2020-01-01',
						endDate: '2025-01-01',
						annualRatePct: 2,
						paymentMinor: '1000'
					},
					{
						startDate: '2025-01-01',
						endDate: null,
						annualRatePct: 4,
						paymentMinor: '1200'
					}
				],
				'2026-08-15'
			)
		).toBe('2026-08-15');
	});

	it('uses the future end of the period currently in force', () => {
		expect(
			defaultFixationStart(
				[
					{
						startDate: '2025-01-01',
						endDate: '2027-01-01',
						annualRatePct: 4,
						paymentMinor: '1200'
					}
				],
				'2026-08-15'
			)
		).toBe('2027-01-01');
	});
});
