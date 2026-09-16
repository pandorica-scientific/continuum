import { describe, expect, it } from 'vitest';
import { detectCurrency, payslipCurrency } from '$lib/salary';

// What the app can convert. Everything the detector may answer comes from here.
const AVAILABLE = ['CZK', 'EUR', 'USD', 'PLN', 'GBP', 'CHF'];

describe('reading a payslip’s currency', () => {
	// Regression: a Czech slip was once stored as 135 887 EUR under a euro household.
	it('reads a Czech slip printing Kč', () => {
		const lines = ['Hrubá mzda 135 887,00 Kč', 'K výplatě 102 202,00 Kč'];
		expect(detectCurrency(lines, AVAILABLE)).toBe('CZK');
	});

	it('reads a slip whose exporter stripped the diacritic', () => {
		expect(detectCurrency(['Hruba mzda 135 887,00 Kc'], AVAILABLE)).toBe('CZK');
	});

	it('reads an ISO code printed as a column heading', () => {
		expect(detectCurrency(['Gross salary EUR 4 200,00'], AVAILABLE)).toBe('EUR');
	});

	it('reads the common symbols', () => {
		expect(detectCurrency(['Net pay € 3 100,00'], AVAILABLE)).toBe('EUR');
		expect(detectCurrency(['Net pay $4,200.00'], AVAILABLE)).toBe('USD');
		expect(detectCurrency(['Net pay £3,100.00'], AVAILABLE)).toBe('GBP');
		expect(detectCurrency(['Wynagrodzenie 8 400,00 zł'], AVAILABLE)).toBe('PLN');
	});

	it('takes the currency the slip names most, not the first one it mentions', () => {
		const lines = [
			'Kurz EUR 25,10',
			'Hrubá mzda 135 887,00 Kč',
			'Záloha na daň 20 383,00 Kč',
			'K výplatě 102 202,00 Kč'
		];
		expect(detectCurrency(lines, AVAILABLE)).toBe('CZK');
	});

	// Null is a question the form asks once. A guess is silent and wrong.
	it('says nothing when the slip names no currency', () => {
		expect(detectCurrency(['Hrubá mzda 135 887,00', 'K výplatě 102 202,00'], AVAILABLE)).toBeNull();
	});

	it('says nothing when two currencies are named equally often', () => {
		expect(detectCurrency(['Gross EUR 4 200', 'Paid USD 4 200'], AVAILABLE)).toBeNull();
	});

	// A currency with no conversion rate cannot be a valid answer either.
	it('never answers with a currency the app cannot convert', () => {
		expect(detectCurrency(['Net pay 3 100,00 Kč'], ['EUR', 'USD'])).toBeNull();
	});

	it('is not fooled by a code inside a word', () => {
		expect(
			detectCurrency(['Zaměstnavatel: PLNOSERVIS s.r.o.', 'Mzda 30 000'], AVAILABLE)
		).toBeNull();
		expect(detectCurrency(['Oddělení USDA', 'Pay 3 000'], AVAILABLE)).toBeNull();
	});

	it('reads nothing out of an empty slip', () => {
		expect(detectCurrency([], AVAILABLE)).toBeNull();
	});
});

describe('whose answer the currency field takes', () => {
	it('takes the slip when the slip says', () => {
		expect(payslipCurrency('CZK', null)).toEqual({ currency: 'CZK', from: 'slip' });
	});

	// This month's printed currency is a fact and overrules a remembered guess.
	it('lets the slip overrule what was remembered', () => {
		expect(payslipCurrency('EUR', 'CZK')).toEqual({ currency: 'EUR', from: 'slip' });
	});

	it('falls back to what was stated last time, and says so', () => {
		expect(payslipCurrency(null, 'CZK')).toEqual({ currency: 'CZK', from: 'learned' });
	});

	// Not the household's base. Null is the form's cue to ask.
	it('answers nothing when neither knows', () => {
		expect(payslipCurrency(null, null)).toEqual({ currency: null, from: null });
	});
});
