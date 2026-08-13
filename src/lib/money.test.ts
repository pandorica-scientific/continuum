import { describe, expect, it } from 'vitest';
import { formatMinor, parseAmountToMinor } from './money';

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
});
