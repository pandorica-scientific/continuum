// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { compactMinor } from '$lib/money';

describe('compactMinor', () => {
	it('abbreviates millions to two decimals', () => {
		expect(compactMinor(437_421_800n, 'CZK')).toBe('4.37M');
	});

	it('abbreviates thousands with no decimals, because the cents do not scan', () => {
		expect(compactMinor(4_101_021n, 'EUR')).toBe('41k');
	});

	it('leaves small amounts alone, so a flagged filing shows its real size', () => {
		expect(compactMinor(36_800n, 'PLN')).toBe('368');
	});

	it('respects a zero-decimal currency', () => {
		// JPY has no minor unit: 4 370 000 minor units IS 4 370 000 yen.
		expect(compactMinor(4_370_000n, 'JPY')).toBe('4.37M');
	});

	it('carries the sign', () => {
		expect(compactMinor(-437_421_800n, 'CZK')).toBe('-4.37M');
	});

	it('renders zero as zero, not as 0k', () => {
		expect(compactMinor(0n, 'EUR')).toBe('0');
	});

	it('does not round a figure up across its own threshold', () => {
		// 999 999.99 is not "1000k" and not "1.00M" — it is still in the hundreds
		// of thousands, and a column that says otherwise is lying by one order.
		expect(compactMinor(99_999_999n, 'EUR')).toBe('1000k');
	});

	it('handles an amount too large for a Number without losing the magnitude', () => {
		expect(compactMinor(1_000_000_000_000n, 'EUR')).toBe('10000.00M');
	});
});
