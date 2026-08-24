// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { compactAxis, compactMinor } from '$lib/money';

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

describe('compactAxis', () => {
	it('raises precision until adjacent labels differ', () => {
		// At this magnitude whole thousands collapse: 3396 and 2547 both round to
		// "3k", and an axis whose ticks read 3k, 3k, 2k has stopped meaning
		// anything.
		const ticks = [0n, 84900n, 169800n, 254700n, 339600n];
		const labels = compactAxis(ticks, 'EUR');
		expect(new Set(labels).size).toBe(labels.length);
	});

	it('leaves already-distinct labels at their coarsest', () => {
		const labels = compactAxis([0n, 100000000n, 200000000n], 'EUR');
		expect(labels).toEqual(['0', '1M', '2M']);
	});

	it('gives up gracefully rather than looping on identical values', () => {
		expect(compactAxis([500n, 500n], 'EUR')).toEqual(['5.00', '5.00']);
	});
});
