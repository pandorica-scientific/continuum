// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { equityGrantRows, heldEquityValues } from '$lib/invest/equity-rows';

describe('equityGrantRows', () => {
	const grant = {
		id: 'g1',
		ticker: 'ACME.US',
		label: null,
		currency: 'USD',
		grantedOn: '2025-03-01',
		totalUnits: '400',
		person: 'Petra',
		employer: 'Acme Corp'
	};
	const tranches = [
		{
			id: 'a',
			vestsOn: '2026-03-01',
			units: 100,
			settledOn: '2026-03-01',
			deliveredUnits: 62,
			withheldUnits: 38,
			soldUnits: 0,
			forfeitedOn: null,
			onPayslip: true
		},
		{
			id: 'b',
			vestsOn: '2027-03-01',
			units: 100,
			settledOn: null,
			deliveredUnits: null,
			withheldUnits: null,
			soldUnits: 0,
			forfeitedOn: null,
			onPayslip: false
		}
	];
	it('values vested and pending units at the latest close and marks staleness', () => {
		const [row] = equityGrantRows(
			{
				grants: [{ grant, tranches }],
				prices: new Map([['ACME.US', { day: '2026-09-12', closeMinor: 14230n, currency: 'USD' }]]),
				baseCurrency: 'CZK',
				staleAfterDays: 7,
				toBase: (amount) => amount * 23n
			},
			'2026-09-15'
		);
		expect(row.label).toBe('ACME.US · granted 2025-03-01');
		expect(row.vestedUnits).toBe('100');
		expect(row.heldUnits).toBe('62');
		expect(row.pendingUnits).toBe('100');
		expect(row.nextVest).toBe('2027-03-01 · 100 units');
		expect(row.vestedValue).toBe('8\u202f822.60');
		expect(row.pendingValue).toBe('14\u202f230');
		expect(row.vestedBase).toBe('202\u202f919.80');
		expect(row.priceDay).toBe('2026-09-12');
		expect(row.priceStale).toBe(false);
		expect(row.tranches[0]).toMatchObject({
			state: 'vested',
			onPayslip: true,
			delivered: '62',
			withheld: '38',
			held: '62'
		});
		expect(row.tranches[1]).toMatchObject({ state: 'pending', delivered: null, held: '100' });
	});
	it('has no values and is stale when no close exists', () => {
		const [row] = equityGrantRows(
			{
				grants: [{ grant, tranches }],
				prices: new Map(),
				baseCurrency: 'CZK',
				staleAfterDays: 7,
				toBase: (a) => a
			},
			'2026-09-15'
		);
		expect(row.vestedValue).toBeNull();
		expect(row.vestedBase).toBeNull();
		expect(row.priceStale).toBe(true);
	});
	it('is stale once the close is older than the tolerance, and prints fractional units short', () => {
		const [row] = equityGrantRows(
			{
				grants: [{ grant: { ...grant, totalUnits: '12.500000' }, tranches: [] }],
				prices: new Map([['ACME.US', { day: '2026-09-01', closeMinor: 100n, currency: 'USD' }]]),
				baseCurrency: 'CZK',
				staleAfterDays: 7,
				toBase: (a) => a
			},
			'2026-09-15'
		);
		expect(row.grantedUnits).toBe('12.5');
		expect(row.priceStale).toBe(true);
		expect(row.nextVest).toBeNull();
	});
});

describe('heldEquityValues', () => {
	it('values held units per priced grant in the price currency, and skips unpriced grants', () => {
		const tranches = [
			{
				id: 'a',
				vestsOn: '2026-03-01',
				units: 100,
				settledOn: '2026-03-01',
				deliveredUnits: 62,
				withheldUnits: 38,
				soldUnits: 12,
				forfeitedOn: null,
				onPayslip: false
			}
		];
		const out = heldEquityValues(
			[
				{ grant: { ticker: 'ACME.US' }, tranches },
				{ grant: { ticker: 'NOVA.US' }, tranches }
			],
			new Map([['ACME.US', { day: '2026-09-12', closeMinor: 14230n, currency: 'USD' }]]),
			'2026-09-15'
		);
		expect(out).toEqual([{ valueMinor: 50n * 14230n, currency: 'USD', day: '2026-09-12' }]);
	});
});
