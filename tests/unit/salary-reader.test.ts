// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { detectBonus, extractCandidates, pickGross, pickNet } from '$lib/salary';

// readPayslip needs a PDF and a database, so its PARTS are tested here and its
// wiring is covered by the integration tests. What matters is that a single
// slip yields three independent figures, none of them borrowing another.
describe('a payslip yields three figures', () => {
	const slip = [
		'Mzdový list 08/2026',
		'Hrubá mzda 100 000,00',
		'Mimořádná odměna 25 000,00',
		'Záloha na daň 15 000,00',
		'K výplatě 71 400,00'
	];

	it('reads gross, net and bonus without any of them borrowing another', () => {
		const c = extractCandidates(slip, 'CZK');
		expect(pickGross(c, null)?.amountMinor).toBe(10000000n);
		expect(pickNet(c, null)?.amountMinor).toBe(7140000n);
		expect(detectBonus(c)).toBe(2500000n);
	});

	it('leaves a base of gross minus bonus', () => {
		const c = extractCandidates(slip, 'CZK');
		const gross = pickGross(c, null)!.amountMinor;
		const bonus = detectBonus(c)!;
		expect(gross - bonus).toBe(7500000n);
	});
});
