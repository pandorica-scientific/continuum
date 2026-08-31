// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { parseCnbDaily } from './index';

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
