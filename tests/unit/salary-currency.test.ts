import { describe, expect, it } from 'vitest';
import { detectCurrency } from '$lib/salary';

// What the app can convert. Everything the detector may answer comes from here.
const AVAILABLE = ['CZK', 'EUR', 'USD', 'PLN', 'GBP', 'CHF'];

describe('reading a payslip’s currency', () => {
	// The defect this exists for: a Czech slip filed by a household keeping its
	// books in euro was stored as 135 887 EUR.
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

	// A mark for a currency with no rate cannot be converted, so it must not be
	// an answer either.
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
