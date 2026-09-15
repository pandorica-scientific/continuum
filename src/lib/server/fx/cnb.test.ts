// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseCnbDaily, parseCnbYear, yearsToBackfill } from './index';

const SAMPLE = `12 Aug 2026 #155
Country|Currency|Amount|Code|Rate
Australia|dollar|1|AUD|13.813
EMU|euro|1|EUR|24.905
Hungary|forint|100|HUF|6.221
Poland|zloty|1|PLN|5.842
USA|dollar|1|USD|21.403`;

describe('parseCnbDaily', () => {
	it('parses codes, per-unit rates and the fixing day', () => {
		const rates = parseCnbDaily(SAMPLE);
		expect(rates).toHaveLength(5);
		const eur = rates.find((r) => r.code === 'EUR');
		expect(eur?.rate).toBeCloseTo(24.905);
		expect(eur?.day).toBe('2026-08-12');
	});
	it('normalises multi-unit quotes to per-one-unit', () => {
		const huf = parseCnbDaily(SAMPLE).find((r) => r.code === 'HUF');
		expect(huf?.rate).toBeCloseTo(0.06221);
	});
	it('parses the czech-language variant header and decimal commas', () => {
		const cs = `12.08.2026 #155
země|měna|množství|kód|kurz
EMU|euro|1|EUR|24,905`;
		const rates = parseCnbDaily(cs);
		expect(rates[0].rate).toBeCloseTo(24.905);
		expect(rates[0].day).toBe('2026-08-12');
	});
});

describe('parseCnbYear', () => {
	const YEAR = `Datum|1 AUD|1 EUR|100 HUF|1 USD|
02.01.2024|15,278|24,685|6,460|22,526|
03.01.2024|15,201|24,675|6,480|22,600|`;
	it('reads one fixing per currency per day, per one unit', () => {
		const rates = parseCnbYear(YEAR);
		expect(rates).toHaveLength(8);
		expect(rates.find((r) => r.code === 'EUR' && r.day === '2024-01-03')?.rate).toBeCloseTo(24.675);
		expect(rates.find((r) => r.code === 'HUF' && r.day === '2024-01-02')?.rate).toBeCloseTo(0.0646);
	});
	it('ignores a malformed row', () => {
		expect(parseCnbYear('Datum|1 EUR|\nnot a date|24,1|')).toEqual([]);
	});
});

describe('yearsToBackfill', () => {
	const full = 250;
	it('lists every year from the earliest amount to today that is short of fixings', () => {
		const stored = new Map([
			[2024, 2],
			[2025, full],
			[2026, 30]
		]);
		// Mid-September: ~180 trading days so far, 30 stored is far short.
		expect(yearsToBackfill(2023, stored, '2026-09-15')).toEqual([2023, 2024, 2026]);
		expect(yearsToBackfill(2025, new Map([[2025, full]]), '2025-12-31')).toEqual([]);
		expect(yearsToBackfill(null, new Map(), '2026-09-15')).toEqual([]);
	});
	it('accepts the current year once it has most of its trading days', () => {
		expect(yearsToBackfill(2026, new Map([[2026, 170]]), '2026-09-15')).toEqual([]);
	});
	it('does not ask for years before the source exists', () => {
		expect(yearsToBackfill(1980, new Map(), '1992-06-01')).toEqual([1991, 1992]);
	});
});
