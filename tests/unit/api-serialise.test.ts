import { describe, expect, it } from 'vitest';
import { money } from '$lib/api/serialise';

describe('money', () => {
	it('carries minor units and a currency, never a float', () => {
		expect(money(-455000n, 'CZK')).toEqual({ amountMinor: -455000, currency: 'CZK' });
	});

	it('keeps zero', () => {
		expect(money(0n, 'EUR')).toEqual({ amountMinor: 0, currency: 'EUR' });
	});

	it('throws rather than silently rounding beyond the safe integer range', () => {
		const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
		expect(() => money(tooBig, 'CZK')).toThrow(/safe integer/i);
	});

	it('accepts the largest value that is still exact', () => {
		const edge = BigInt(Number.MAX_SAFE_INTEGER);
		expect(money(edge, 'CZK').amountMinor).toBe(Number.MAX_SAFE_INTEGER);
	});

	it('throws on a large negative too, not only a large positive', () => {
		const tooSmall = -BigInt(Number.MAX_SAFE_INTEGER) - 1n;
		expect(() => money(tooSmall, 'CZK')).toThrow(/safe integer/i);
	});
});
