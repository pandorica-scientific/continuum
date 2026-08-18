import { describe, expect, it } from 'vitest';
import {
	applyDateOrder,
	parseAmount,
	resolveDateOrder,
	resolveDecimalMark,
	resolvePeriod
} from '$lib/server/import/tabular/determinacy';

describe('date order', () => {
	it('is determined by a day above twelve', () => {
		const result = resolveDateOrder(['03.07.2026', '11.07.2026', '21.07.2026']);
		expect(result).toMatchObject({ kind: 'determined', value: 'day-first' });
	});

	it('is determined the other way when the second component exceeds twelve', () => {
		expect(resolveDateOrder(['07/21/2026', '07/04/2026'])).toMatchObject({
			kind: 'determined',
			value: 'month-first'
		});
	});

	it('recognises an ISO column outright', () => {
		expect(resolveDateOrder(['2026-07-04', '2026-07-21'])).toMatchObject({
			kind: 'determined',
			value: 'year-first'
		});
	});

	it('is AMBIGUOUS when every component is twelve or lower', () => {
		// The US fixture is built this way on purpose: 03/04, 03/07, 03/11.
		const result = resolveDateOrder(['03/04', '03/07', '03/11', '03/12']);
		expect(result.kind).toBe('ambiguous');
		if (result.kind === 'ambiguous') {
			expect(result.candidates).toEqual(['day-first', 'month-first']);
			expect(result.reason).toMatch(/12 or lower/);
		}
	});

	it('is settled by the printed period when the dates alone cannot settle it', () => {
		// Only month-first puts 03/04 and 03/11 inside March.
		const result = resolveDateOrder(['03/04/2025', '03/11/2025'], {
			start: '2025-03-01',
			end: '2025-03-31'
		});
		expect(result).toMatchObject({ kind: 'determined', value: 'month-first' });
		if (result.kind === 'determined') expect(result.evidence).toMatch(/inside 2025-03-01/);
	});

	it('does not use monotonicity, because banks post in operational order', () => {
		// Descending dates, all ≤ 12, no period: still ambiguous rather than
		// "obviously day-first because it reads nicely".
		expect(resolveDateOrder(['05/03', '04/03', '02/03']).kind).toBe('ambiguous');
	});

	it('reports a column that fits neither order', () => {
		const result = resolveDateOrder(['21.07.2026', '07.21.2026']);
		expect(result.kind).toBe('ambiguous');
		if (result.kind === 'ambiguous') expect(result.reason).toMatch(/not one format/);
	});

	it('applies a resolved order, pivoting two-digit years', () => {
		expect(applyDateOrder('03.07.2026', 'day-first')).toBe('2026-07-03');
		expect(applyDateOrder('03/07/2026', 'month-first')).toBe('2026-03-07');
		expect(applyDateOrder('03.07.26', 'day-first')).toBe('2026-07-03');
		expect(applyDateOrder('03.07.98', 'day-first')).toBe('1998-07-03');
		expect(applyDateOrder('2026-07-03', 'day-first')).toBe('2026-07-03');
	});

	it('rejects an impossible date rather than shifting it', () => {
		expect(applyDateOrder('32.07.2026', 'day-first')).toBeUndefined();
		// Month-first reads the FIRST component as the month, so 13 is the
		// impossible one here — 03.13 would be a perfectly good 13 March.
		expect(applyDateOrder('13.03.2026', 'month-first')).toBeUndefined();
	});

	it('supplies a year for the bare MM/DD dates US statements print', () => {
		expect(applyDateOrder('03/04', 'month-first', 2025)).toBe('2025-03-04');
		// Without a year to lean on it refuses rather than inventing one.
		expect(applyDateOrder('03/04', 'month-first')).toBeUndefined();
	});
});

describe('decimal mark', () => {
	it('is determined by a value carrying both separators', () => {
		expect(resolveDecimalMark(['1.234,56', '99,00'])).toMatchObject({
			kind: 'determined',
			value: ','
		});
		expect(resolveDecimalMark(['1,234.56', '99.00'])).toMatchObject({
			kind: 'determined',
			value: '.'
		});
	});

	it('is determined by fractional digits when only one separator appears', () => {
		expect(resolveDecimalMark(['10,50', '3,00'])).toMatchObject({ kind: 'determined', value: ',' });
		expect(resolveDecimalMark(['10.50', '3.00'])).toMatchObject({ kind: 'determined', value: '.' });
	});

	it('is AMBIGUOUS when every separator is followed by exactly three digits', () => {
		// "1.234" is a thousand and change, or one point two three four.
		const result = resolveDecimalMark(['1.234', '5.678']);
		expect(result.kind).toBe('ambiguous');
		if (result.kind === 'ambiguous') expect(result.reason).toMatch(/three digits/);
	});

	it('says so when the numbers carry no separator at all', () => {
		// Fio writes whole crowns plainly; both readings agree, so nothing is lost.
		expect(resolveDecimalMark(['-20000', '32892']).kind).toBe('unavailable');
	});
});

describe('parsing an amount under a resolved convention', () => {
	it('reads the sign forms statements actually use', () => {
		expect(parseAmount('-1 234,56', ',')).toBe(-123456n);
		expect(parseAmount('1.234,56-', ',')).toBe(-123456n); // trailing minus
		expect(parseAmount('(48.71)', '.')).toBe(-4871n); // accounting parentheses
		expect(parseAmount('1,234.56', '.')).toBe(123456n);
	});

	it("handles Switzerland's apostrophe grouping", () => {
		expect(parseAmount("1'234.55", '.')).toBe(123455n);
	});

	it('handles space-grouped thousands', () => {
		expect(parseAmount('54 650.00', '.')).toBe(5465000n);
		expect(parseAmount('12 500', ',', 0)).toBe(12500n);
	});

	it('honours zero-decimal currencies', () => {
		// HUF has no minor unit: 12 500 forint is 12500, not 1 250 000.
		expect(parseAmount('12 500', ',', 0)).toBe(12500n);
	});

	it('rounds at the stored precision rather than truncating', () => {
		// With "." as the decimal, the comma groups thousands: 1,005 is one
		// thousand and five, not one and a bit.
		expect(parseAmount('1,005', '.', 2)).toBe(100500n);
		expect(parseAmount('10.005', '.', 2)).toBe(1001n); // rounds the half up
	});

	it('returns null for text that is not a number', () => {
		expect(parseAmount('Biedronka', ',')).toBeNull();
		expect(parseAmount('', ',')).toBeNull();
		expect(parseAmount('--', ',')).toBeNull();
	});
});

describe('signs a statement actually prints', () => {
	it('reads a U+2212 MINUS SIGN as a minus', () => {
		// `formatMinor` emits one and Raiffeisenbank's PDFs print it literally, so
		// `adapters/rb.ts` folds it by hand. The generic reader is the fallback for
		// every bank without an adapter and read those cells as "not a number",
		// dropping every signed amount on the page.
		expect(parseAmount('\u22121 000,00', ',', 2)).toBe(-100_000n);
		expect(parseAmount('\u2212249.00', '.', 2)).toBe(-24_900n);
	});

	it('reads an explicit plus as a credit', () => {
		// NUMBER_SHAPE accepts a leading `+`, so a bank writing `+249,00` passed the
		// shape test and then failed the digits-only test one line below — null for
		// every credit it has, which drops the amount column under its coverage
		// threshold and refuses the statement.
		expect(parseAmount('+249.00', '.', 2)).toBe(24_900n);
		expect(parseAmount('+1 234,56', ',', 2)).toBe(123_456n);
	});
});

describe('the period a statement prints', () => {
	it('is read when only one order can be meant', () => {
		// 31 cannot be a month, so the period can only run 31 Jan to 28 Feb.
		expect(resolvePeriod('31.01.2026', '28.02.2026')).toEqual({
			start: '2026-01-31',
			end: '2026-02-28'
		});
	});

	it('settles nothing when both readings are possible', () => {
		// `01/05/2026` to `02/06/2026` is 5 Jan to 6 Feb in a US export and 1 May
		// to 2 June in a European one. Both are real periods that run forwards, so
		// the file does not say which of them it means.
		//
		// This used to be parsed as day-first outright, and the result was then
		// handed to `resolveDateOrder` as the evidence that SETTLED the rows'
		// order — reporting `kind: 'determined'` with a confident evidence string
		// while every movement imported four months out.
		expect(resolvePeriod('01/05/2026', '02/06/2026')).toBeUndefined();
	});

	it('does not let an ambiguous period determine the rows', () => {
		const dates = ['01/05/2026', '02/05/2026', '02/06/2026'];
		expect(resolveDateOrder(dates, resolvePeriod('01/05/2026', '02/06/2026'))).toMatchObject({
			kind: 'ambiguous'
		});
	});

	it('is not ambiguous when both readings agree', () => {
		// An ISO period carries its own year first, so the order cannot change it.
		expect(resolvePeriod('2026-05-01', '2026-06-02')).toEqual({
			start: '2026-05-01',
			end: '2026-06-02'
		});
	});

	it('rejects a period that runs backwards under both readings', () => {
		expect(resolvePeriod('28.02.2026', '31.01.2026')).toBeUndefined();
	});
});
