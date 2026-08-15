import { describe, expect, it } from 'vitest';
import { accountBalanceInBase } from '$lib/accounts/balance';

describe('accountBalanceInBase', () => {
	it('keeps a missing-rate account in totals while marking its display conversion unavailable', () => {
		expect(accountBalanceInBase(new Map(), 12_345n, 'EUR', 'CZK', '2026-08-15')).toEqual({
			exactMinor: null,
			totalMinor: 12_345n
		});
	});

	it('uses an available rate for both display and totals', () => {
		const rates = new Map([['EUR', [{ day: '2026-08-15', rate: 25 }]]]);

		expect(accountBalanceInBase(rates, 10_000n, 'EUR', 'CZK', '2026-08-15')).toEqual({
			exactMinor: 250_000n,
			totalMinor: 250_000n
		});
	});

	it('preserves major-unit face value across different minor-unit scales', () => {
		expect(accountBalanceInBase(new Map(), 1_000n, 'JPY', 'CZK', '2026-08-15')).toEqual({
			exactMinor: null,
			totalMinor: 100_000n
		});
	});
});
