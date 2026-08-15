import { describe, expect, it } from 'vitest';
import {
	conversionBasis,
	convertMinorSync,
	convertOrFace,
	missingRateCodes,
	type RateTable
} from '$lib/server/fx/table';

const rates = (entries: [string, { day: string; rate: number }[]][]): RateTable => new Map(entries);

describe('historical FX conversion', () => {
	// refreshRates only fetches the current fixing and the CNB publishes
	// forward, so a day before the first fetch can never gain its own rate.
	// Returning null here read as face value: 10 000 EUR counted as 10 000 CZK.
	it('carries the oldest fixing back before the first known day', () => {
		const table = rates([['EUR', [{ day: '2026-01-02', rate: 25 }]]]);

		expect(convertMinorSync(table, 100n, 'EUR', 'CZK', '2020-01-01')).toBe(2500n);
		expect(conversionBasis(table, 'EUR', 'CZK', '2020-01-01')).toBe('carried');
		expect(conversionBasis(table, 'EUR', 'CZK', '2026-01-02')).toBe('exact');
	});

	it('still reports no rate when the currency has no fixing at all', () => {
		const table = rates([['EUR', [{ day: '2026-01-02', rate: 25 }]]]);

		expect(convertMinorSync(table, 100n, 'USD', 'CZK', '2026-01-02')).toBeNull();
		expect(conversionBasis(table, 'USD', 'CZK', '2026-01-02')).toBe('none');
	});

	// proposePairs skips its cross-currency branch whenever convert returns
	// null, so both legs of an own transfer keep counting as real income and
	// real spending. A carried rate keeps that comparison alive.
	it('keeps a cross-currency comparison possible for historical statements', () => {
		const table = rates([
			['EUR', [{ day: '2026-01-02', rate: 25 }]],
			['PLN', [{ day: '2026-01-02', rate: 6 }]]
		]);

		expect(convertMinorSync(table, 10_000n, 'EUR', 'PLN', '2023-05-05')).not.toBeNull();
	});

	it('uses the newest fixing on or before the requested day', () => {
		const table = rates([
			[
				'EUR',
				[
					{ day: '2026-01-03', rate: 26 },
					{ day: '2026-01-02', rate: 25 }
				]
			]
		]);

		expect(convertMinorSync(table, 100n, 'EUR', 'CZK', '2026-01-02')).toBe(2500n);
	});
});

describe('missing-rate fallback', () => {
	it('preserves major-unit magnitude across different minor-unit scales', () => {
		expect(convertOrFace(new Map(), 1500n, 'JPY', 'CZK', '2020-01-01')).toBe(150000n);
		expect(convertOrFace(new Map(), 12345n, 'KWD', 'JPY', '2020-01-01')).toBe(12n);
	});

	it('reports a historical fallback even when a current fixing exists', () => {
		const table = rates([['EUR', [{ day: '2026-01-02', rate: 25 }]]]);

		expect(missingRateCodes(table, [{ currency: 'EUR', day: '2020-01-01' }], 'CZK')).toEqual([
			'EUR'
		]);
		expect(missingRateCodes(table, [{ currency: 'EUR', day: '2026-01-02' }], 'CZK')).toEqual([]);
	});
});
