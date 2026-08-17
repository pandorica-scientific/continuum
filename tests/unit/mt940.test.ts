import { describe, expect, it } from 'vitest';
import { parseMt940 } from '$lib/server/import/standards/mt940';

const FILE = [
	':20:STMT-2025-03',
	':25:CZ6955000000000093531803',
	':28C:3/1',
	':60F:C250301CZK35971,21',
	':61:2503010301D6103,00NTRFVS1032122213//7108202415',
	':86:?20SPOLECENSTVI VLASTNIKU?21NAJEM BREZEN',
	':61:2503040304C15000,00NTRFMZDA//7110240770',
	':86:ZAMESTNAVATEL A.S.',
	':61:2503050305D5415,90NMSCKARTA//7112671245',
	':86:SUPERMARKET PRAHA 4',
	':62F:C250331CZK39452,31',
	'-'
].join('\n');

describe('MT940', () => {
	const [statement] = parseMt940(FILE);

	it('reads the account, currency and period from the balance tags', () => {
		expect(statement.bank).toBe('mt940');
		expect(statement.format).toBe('mt940');
		expect(statement.accountNumber).toBe('CZ6955000000000093531803');
		expect(statement.currency).toBe('CZK');
		expect(statement.periodStart).toBe('2025-03-01');
		expect(statement.periodEnd).toBe('2025-03-31');
	});

	it('reads every movement with its references', () => {
		expect(statement.rows).toHaveLength(3);
		expect(statement.rows[0].amountMinor).toBe(-610300n);
		expect(statement.rows[0].bankRef).toBe('7108202415');
		expect(statement.rows[1].amountMinor).toBe(1500000n);
	});

	it('attaches :86: details to the movement above them', () => {
		expect(statement.rows[0].description).toContain('SPOLECENSTVI VLASTNIKU');
		expect(statement.rows[1].counterparty).toContain('ZAMESTNAVATEL');
	});

	it('reconciles against its own opening and closing balances', () => {
		const sum = statement.rows.reduce((a, r) => a + r.amountMinor, 0n);
		expect(statement.openingBalanceMinor).toBe(3597121n);
		expect(statement.openingBalanceMinor! + sum).toBe(statement.closingBalanceMinor);
	});

	it('treats RD and RC as reversals, which move money the other way', () => {
		const reversals = parseMt940(
			[
				':20:REV',
				':25:123',
				':60F:C250301EUR0,00',
				':61:2503010301RD100,00NTRFREVERSED-DEBIT',
				':61:2503010301RC100,00NTRFREVERSED-CREDIT',
				':62F:C250331EUR0,00'
			].join('\n')
		)[0];
		// A reversed debit returns money; a reversed credit takes it back.
		expect(reversals.rows[0].amountMinor).toBe(10000n);
		expect(reversals.rows[1].amountMinor).toBe(-10000n);
	});

	it('honours the currency when deciding minor units', () => {
		// HUF has no minor unit: 12 500 forint is 12500, not 1 250 000.
		const huf = parseMt940(
			[
				':20:HU',
				':25:1',
				':60F:C250301HUF0,00',
				':61:2503010301C12500,NTRFX',
				':62F:C250331HUF12500,'
			].join('\n')
		)[0];
		expect(huf.currency).toBe('HUF');
		expect(huf.rows[0].amountMinor).toBe(12500n);
	});

	it('dates an entry in December against a January value date to the year before', () => {
		const boundary = parseMt940(
			[
				':20:NY',
				':25:1',
				':60F:C250101EUR0,00',
				':61:2501021231D10,00NTRFX',
				':62F:C250131EUR0,00'
			].join('\n')
		)[0];
		expect(boundary.rows[0].valueDate).toBe('2025-01-02');
		expect(boundary.rows[0].bookedAt).toBe('2024-12-31');
	});

	it('ignores :64: available balance, which is not the ledger balance', () => {
		const withAvailable = parseMt940(
			[
				':20:AV',
				':25:1',
				':60F:C250301EUR100,00',
				':61:2503010301D10,00NTRFX',
				':62F:C250331EUR90,00',
				':64:C250331EUR50,00'
			].join('\n')
		)[0];
		expect(withAvailable.closingBalanceMinor).toBe(9000n);
	});

	it('returns one statement per :20: block', () => {
		const two = parseMt940(`${FILE}\n${FILE.replace('STMT-2025-03', 'STMT-2025-04')}`);
		expect(two).toHaveLength(2);
		expect(two[1].rows).toHaveLength(3);
	});

	it('unwraps a SWIFT block-4 envelope', () => {
		const wrapped = `{1:F01BANKXXX}{2:I940}{4:\n${FILE}\n-}`;
		expect(parseMt940(wrapped)[0].rows).toHaveLength(3);
	});

	it('refuses a file with no :20: tag', () => {
		expect(() => parseMt940('nothing here\n')).toThrow(/:20:/);
	});
});
