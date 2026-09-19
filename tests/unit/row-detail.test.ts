// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { identifyingDetail } from '$lib/import/row-detail';

describe('the detail behind a row that names nothing', () => {
	it('leads with the account number, which is what repeats month to month', () => {
		// The real row: a QR-code payment to ČEZ. The statement says "QR Platba"
		// and never says ČEZ, so this is every identifying fact there is.
		const detail = identifyingDetail(
			{
				counterparty: 'QR Platba',
				counterpartyAccount: '7770227/0100',
				variableSymbol: '8108749269',
				description: 'Tuzemská odchozí úhrada · okamžitá · QR Platba'
			},
			'QR Platba'
		);
		expect(detail).toEqual([
			{ label: 'To account', value: '7770227/0100' },
			{ label: 'Variable symbol', value: '8108749269' },
			{ label: 'On the statement', value: 'Tuzemská odchozí úhrada · okamžitá · QR Platba' }
		]);
	});

	it('does not repeat the name the row is already showing', () => {
		const detail = identifyingDetail(
			{ description: 'Odvod daně z úroků' },
			// With no counterparty the screen falls back to the description, so
			// printing it again in the panel would be the same words twice.
			'odvod daně z úroků'
		);
		expect(detail).toEqual([]);
	});

	it('is empty when the statement carried nothing but a name', () => {
		expect(identifyingDetail({ counterparty: 'Albert' }, 'Albert')).toEqual([]);
		expect(identifyingDetail({}, null)).toEqual([]);
	});

	it('ignores blank and whitespace-only fields rather than showing empty rows', () => {
		expect(
			identifyingDetail({ counterpartyAccount: '   ', variableSymbol: '', bankRef: null }, 'x')
		).toEqual([]);
	});

	it('shows what a card was charged abroad, beside its own currency', () => {
		const detail = identifyingDetail(
			{ originalAmountMinor: -1499n, originalCurrency: 'EUR' },
			'Apple'
		);
		expect(detail).toEqual([{ label: 'Charged', value: '-14.99 EUR' }]);
	});

	it('pads a sub-unit amount rather than printing .9', () => {
		expect(identifyingDetail({ originalAmountMinor: 9n, originalCurrency: 'USD' }, null)).toEqual([
			{ label: 'Charged', value: '0.09 USD' }
		]);
	});

	it('carries the symbols a Czech payment is reconciled by', () => {
		const detail = identifyingDetail(
			{ constantSymbol: '0308', specificSymbol: '12345', counterpartyAccount: '2171532/0800' },
			'Alza.cz'
		);
		expect(detail.map((d) => d.label)).toEqual([
			'To account',
			'Constant symbol',
			'Specific symbol'
		]);
	});
});
