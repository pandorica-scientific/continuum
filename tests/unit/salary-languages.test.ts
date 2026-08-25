// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The wordings a payslip prints, in the languages a household is likely to be
// paid in. Learning covers any language after one correction; these decide
// whether the FIRST slip from a new employer reads itself.
import { describe, expect, it } from 'vitest';
import { detectPeriod, extractCandidates, pickGross, pickNet } from '$lib/salary';

const read = (lines: string[], currency = 'EUR') => {
	const c = extractCandidates(lines, currency);
	return { gross: pickGross(c, null)?.amountMinor, net: pickNet(c, null)?.amountMinor };
};

describe('reading a payslip in each language', () => {
	it('German', () => {
		expect(read(['Gesamtbrutto 4.200,00', 'Auszahlungsbetrag 2.640,50'])).toEqual({
			gross: 420000n,
			net: 264050n
		});
	});

	it('French', () => {
		expect(read(['Salaire brut 3.500,00', 'Net à payer 2.730,20'])).toEqual({
			gross: 350000n,
			net: 273020n
		});
	});

	it('Italian', () => {
		expect(read(['Totale competenze 2.900,00', 'Netto in busta 2.180,40'])).toEqual({
			gross: 290000n,
			net: 218040n
		});
	});

	it('Polish', () => {
		expect(read(['Wynagrodzenie brutto 12 000,00', 'Do wypłaty 8 640,00'], 'PLN')).toEqual({
			gross: 1200000n,
			net: 864000n
		});
	});

	it('Dutch', () => {
		expect(read(['Totaal bruto 3.800,00', 'Netto uitbetaald 2.720,00'])).toEqual({
			gross: 380000n,
			net: 272000n
		});
	});

	it('Portuguese', () => {
		expect(read(['Remuneração bruta 2.400,00', 'Líquido a receber 1.810,00'])).toEqual({
			gross: 240000n,
			net: 181000n
		});
	});
});

describe('what must never be read as gross', () => {
	/**
	 * Total employment cost sits above gross on the page and is LARGER than it.
	 * Every language's word for it has to be excluded, or a slip that prints the
	 * cost line and no gross line hands the cost over as the salary.
	 */
	it('leaves employer cost alone in each language', () => {
		for (const [cost, gross] of [
			['Arbeitgeberkosten 5.400,00', 'Gesamtbrutto 4.200,00'],
			['Coût total employeur 4.900,00', 'Salaire brut 3.500,00'],
			['Costo azienda 4.100,00', 'Totale competenze 2.900,00'],
			['Coste empresa 9.800,00', 'Total devengo 7.570,84']
		]) {
			expect(read([cost, gross]).gross).not.toBe(
				pickGross(extractCandidates([cost], 'EUR'), null)?.amountMinor
			);
		}
	});

	it('reads no gross at all from a slip that prints only the cost', () => {
		expect(read(['Arbeitgeberkosten 5.400,00']).gross).toBeUndefined();
		expect(read(['Charges patronales 1.900,00']).gross).toBeUndefined();
	});

	// The taxable base is not what anybody is paid.
	it('does not take the French taxable base as the amount paid', () => {
		expect(read(['Net imposable 3.100,00', 'Net à payer 2.730,20']).net).toBe(273020n);
	});
});

describe('a month named in another language', () => {
	it('is recognised', () => {
		expect(detectPeriod(['Abrechnung März 2026'])).toBe('2026-03');
		expect(detectPeriod(['Bulletin de paie — juillet 2025'])).toBe('2025-07');
		expect(detectPeriod(['Nómina de septiembre 2024'])).toBe('2024-09');
		expect(detectPeriod(['Busta paga dicembre 2025'])).toBe('2025-12');
		expect(detectPeriod(['Wynagrodzenie za październik 2025'])).toBe('2025-10');
		expect(detectPeriod(['Salarisstrook augustus 2025'])).toBe('2025-08');
	});

	it('is recognised where the exporter dropped the accents', () => {
		expect(detectPeriod(['Abrechnung Marz 2026'])).toBe('2026-03');
		expect(detectPeriod(['Paie aout 2025'])).toBe('2025-08');
	});

	// Polish writes the month in the genitive when it writes a date.
	it('reads the form a date is actually written in', () => {
		expect(detectPeriod(['Za okres 1 stycznia 2025'])).toBe('2025-01');
	});
});
