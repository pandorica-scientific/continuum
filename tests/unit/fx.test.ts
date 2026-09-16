import { describe, expect, it } from 'vitest';
import {
	conversionBasis,
	convertMinorSync,
	convertOrFace,
	missingRateCodes,
	type RateTable
} from '$lib/server/fx/table';
import { orderCurrencies } from '$lib/server/fx/currencies';

const rates = (entries: [string, { day: string; rate: number }[]][]): RateTable => new Map(entries);

describe('historical FX conversion', () => {
	// No fixing exists before the first fetch date; carry the oldest known rate back instead of null.
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

	// A carried rate keeps cross-currency comparisons working for historical statements.
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

	// A missing rate and a carried historical rate call for different advice, so they're reported apart.
	it('separates a historical fallback from having no rate at all', () => {
		const table = rates([['EUR', [{ day: '2026-01-02', rate: 25 }]]]);

		// A rate exists, but this figure predates it.
		expect(missingRateCodes(table, [{ currency: 'EUR', day: '2020-01-01' }], 'CZK')).toEqual({
			carried: ['EUR'],
			none: []
		});

		// On or after the fixing: exact, and nothing is reported.
		expect(missingRateCodes(table, [{ currency: 'EUR', day: '2026-01-02' }], 'CZK')).toEqual({
			carried: [],
			none: []
		});

		// Nothing stored for this currency at all.
		expect(missingRateCodes(table, [{ currency: 'PLN', day: '2026-01-02' }], 'CZK')).toEqual({
			carried: [],
			none: ['PLN']
		});
	});

	// The stronger problem wins: a currency used both before and after its first
	// fixing is reported once, under the advice that helps.
	it('reports a currency with no rate only once', () => {
		const table = rates([['EUR', [{ day: '2026-01-02', rate: 25 }]]]);
		const result = missingRateCodes(
			table,
			[
				{ currency: 'PLN', day: '2020-01-01' },
				{ currency: 'PLN', day: '2026-06-01' }
			],
			'CZK'
		);
		expect(result).toEqual({ carried: [], none: ['PLN'] });
	});
});

describe('orderCurrencies', () => {
	it('puts the base first, then what the household holds, then the rest alphabetically', () => {
		expect(orderCurrencies('EUR', ['USD', 'GBP', 'EUR'], ['CZK', 'PLN', 'USD', 'AUD'])).toEqual([
			'EUR',
			'GBP',
			'USD',
			'AUD',
			'CZK',
			'PLN'
		]);
	});
	it('offers the base even when nothing quotes it', () => {
		expect(orderCurrencies('XAU', [], ['EUR'])).toEqual(['XAU', 'EUR']);
	});
});
