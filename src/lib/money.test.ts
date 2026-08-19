// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { formatMinor, minorDigits, parseAmountToMinor } from './money';

describe('formatMinor', () => {
	it('groups thousands with narrow spaces and drops zero fractions', () => {
		expect(formatMinor(1057590000n, 'CZK')).toBe('10 575 900');
	});
	it('keeps a meaningful fraction', () => {
		expect(formatMinor(23979n, 'CZK')).toBe('239.79');
	});
	it('prints exact fractions when asked', () => {
		expect(formatMinor(500000n, 'EUR', { exact: true })).toBe('5 000.00');
	});
	it('uses a proper minus and optional plus', () => {
		expect(formatMinor(-5391n, 'CZK')).toBe('−53.91');
		expect(formatMinor(5391n, 'CZK', { signed: true })).toBe('+53.91');
	});
});

describe('parseAmountToMinor', () => {
	it('parses czech decimal commas and grouped thousands', () => {
		expect(parseAmountToMinor('12 984,38', 'CZK')).toBe(1298438n);
	});
	it('parses plain dot decimals and signs', () => {
		expect(parseAmountToMinor('-53.91', 'CZK')).toBe(-5391n);
		expect(parseAmountToMinor('+310,00', 'PLN')).toBe(31000n);
	});
	it('pads short fractions', () => {
		expect(parseAmountToMinor('5.5', 'EUR')).toBe(550n);
	});
	it('rejects garbage', () => {
		expect(() => parseAmountToMinor('abc', 'CZK')).toThrow();
	});

	it('round-trips its own formatted output', () => {
		// formatMinor emits U+2212, the typographic minus. The parser accepting
		// only ASCII "-" meant a formatted amount could not be read back, so any
		// pre-filled input threw the moment it was submitted unchanged.
		for (const [minor, currency] of [
			[-5391n, 'CZK'],
			[1298438n, 'CZK'],
			[-310000n, 'EUR'],
			[0n, 'PLN']
		] as const) {
			const printed = formatMinor(minor, currency, { exact: true });
			expect(parseAmountToMinor(printed, currency)).toBe(minor);
		}
	});

	it('rounds excess decimals instead of truncating', () => {
		expect(parseAmountToMinor('12.999', 'CZK')).toBe(1300n);
		expect(parseAmountToMinor('12.994', 'CZK')).toBe(1299n);
		expect(parseAmountToMinor('12.995', 'CZK')).toBe(1300n);
		expect(parseAmountToMinor('-12.999', 'CZK')).toBe(-1300n);
	});
});

describe('minor units per currency', () => {
	it('follows ISO 4217, not a four-entry table', () => {
		// availableCurrencies() offers every code the CNB quotes, and several of
		// them have no minor unit. Assuming 2 stored these 100x too large and
		// fed the same factor to the register's amount filter and the API.
		expect(minorDigits('CZK')).toBe(2);
		expect(minorDigits('EUR')).toBe(2);
		expect(minorDigits('JPY')).toBe(0);
		expect(minorDigits('KRW')).toBe(0);
		expect(minorDigits('HUF')).toBe(0);
		expect(minorDigits('ISK')).toBe(0);
	});

	it('formats and parses a zero-decimal currency without inventing cents', () => {
		expect(formatMinor(1500n, 'JPY')).toBe('1 500'); // narrow no-break space
		expect(parseAmountToMinor('1 500', 'JPY')).toBe(1500n);
		expect(parseAmountToMinor('1500', 'JPY')).toBe(1500n);
		expect(formatMinor(1500n, 'JPY', { exact: true })).toBe('1 500');
	});

	it('falls back to 2 for an unknown but well-formed code', () => {
		expect(minorDigits('XYZ')).toBe(2);
	});
});
