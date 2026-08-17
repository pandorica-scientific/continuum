import { describe, expect, it } from 'vitest';
import { parseAbo } from '$lib/server/import/standards/abo';

/** Build a 128-character ABO record from its fields, padded as the spec says. */
const num = (value: string | number, width: number) => String(value).padStart(width, '0');
const txt = (value: string, width: number) => value.slice(0, width).padEnd(width, ' ');

function headerFields(o: {
	account: string;
	name?: string;
	openingDate: string;
	opening: number;
	openingSign?: '+' | '-';
	closing: number;
	closingSign?: '+' | '-';
	debitTurnover: number;
	creditTurnover: number;
	statementNo?: number;
	bookingDate: string;
}) {
	return (
		'074' +
		num(o.account, 16) +
		txt(o.name ?? 'NOVAKOVA JANA', 20) +
		o.openingDate +
		num(o.opening, 14) +
		(o.openingSign ?? '+') +
		num(o.closing, 14) +
		(o.closingSign ?? '+') +
		num(o.debitTurnover, 14) +
		'+' +
		num(o.creditTurnover, 14) +
		'+' +
		num(o.statementNo ?? 1, 3) +
		o.bookingDate +
		' '.repeat(14)
	);
}

/** The format is fixed width; a fixture that is not 128 columns is a bug. */
function record(line: string): string {
	if (line.length !== 128) {
		throw new Error(`ABO record must be 128 columns, got ${line.length}: ${line}`);
	}
	return line;
}

const header = (o: Parameters<typeof headerFields>[0]) => record(headerFields(o));
const movement = (o: Parameters<typeof movementFields>[0]) => record(movementFields(o));

function movementFields(o: {
	account: string;
	counterAccount: string;
	document?: string;
	amount: number;
	code: '1' | '2' | '3' | '4';
	vs?: string;
	ks?: string;
	ss?: string;
	valueDate: string;
	note?: string;
	dueDate?: string;
}) {
	return (
		'075' +
		num(o.account, 16) +
		num(o.counterAccount, 16) +
		num(o.document ?? '1', 13) +
		num(o.amount, 12) +
		o.code +
		num(o.vs ?? '0', 10) +
		num(o.ks ?? '0', 10) +
		num(o.ss ?? '0', 10) +
		o.valueDate +
		txt(o.note ?? '', 20) +
		'0' +
		'1101' +
		(o.dueDate ?? o.valueDate)
	);
}

// 19-2000145399 passes the Czech modulo-11 check on both halves, so the parser
// should read it as-is rather than as a permuted internal-format field.
const ACCOUNT = '0000192000145399';

describe('ABO/GPC', () => {
	const file = [
		header({
			account: ACCOUNT,
			openingDate: '010325',
			opening: 3597121,
			closing: 3945231,
			debitTurnover: 1151890,
			creditTurnover: 1500000,
			bookingDate: '310325'
		}),
		movement({
			account: ACCOUNT,
			counterAccount: '0000001011097041',
			amount: 610300,
			code: '1',
			vs: '1032122213',
			ks: '0055000308', // 10 wide: bank code 5500 at 5-8 from the right, KS 0308
			valueDate: '030325',
			note: 'SPOLECENSTVI VLASTNIK'
		}),
		movement({
			account: ACCOUNT,
			counterAccount: '0000002500834780',
			amount: 1500000,
			code: '2',
			valueDate: '040325',
			note: 'MZDA'
		}),
		movement({
			account: ACCOUNT,
			counterAccount: '0000000035801902',
			amount: 541590,
			code: '1',
			valueDate: '050325'
		})
	].join('\r\n');

	const [statement] = parseAbo(file);

	it('records every field as 128-column fixed width', () => {
		expect(statement.bank).toBe('abo');
		expect(statement.format).toBe('abo');
		expect(statement.currency).toBe('CZK');
		expect(statement.periodStart).toBe('2025-03-01');
		expect(statement.periodEnd).toBe('2025-03-31');
		expect(statement.rows).toHaveLength(3);
	});

	it('reads amounts as minor units, with no decimal to misparse', () => {
		// 610300 haléře is 6 103,00 Kč — the field IS the minor value.
		expect(statement.rows[0].amountMinor).toBe(-610300n);
		expect(statement.openingBalanceMinor).toBe(3597121n);
		expect(statement.closingBalanceMinor).toBe(3945231n);
	});

	it('takes the sign from the posting code, not the amount', () => {
		expect(statement.rows[0].amountMinor < 0n).toBe(true); // code 1, debit
		expect(statement.rows[1].amountMinor > 0n).toBe(true); // code 2, credit
	});

	it('treats codes 3 and 4 as reversals, which invert their base direction', () => {
		const reversals = parseAbo(
			[
				header({
					account: ACCOUNT,
					openingDate: '010325',
					opening: 0,
					closing: 0,
					debitTurnover: 0,
					creditTurnover: 0,
					bookingDate: '310325'
				}),
				movement({
					account: ACCOUNT,
					counterAccount: '0000001011097041',
					amount: 5000,
					code: '3',
					valueDate: '030325'
				}),
				movement({
					account: ACCOUNT,
					counterAccount: '0000001011097041',
					amount: 5000,
					code: '4',
					valueDate: '030325'
				})
			].join('\n')
		)[0];
		// A reversed debit returns money; a reversed credit takes it back.
		expect(reversals.rows[0].amountMinor).toBe(5000n);
		expect(reversals.rows[1].amountMinor).toBe(-5000n);
	});

	it('recovers the counter-account bank code hidden in the constant symbol', () => {
		expect(statement.rows[0].counterpartyAccount).toBe('1011097041/5500');
		expect(statement.rows[0].constantSymbol).toBe('308');
		expect(statement.rows[0].variableSymbol).toBe('1032122213');
	});

	it('reconciles, and states its own turnovers', () => {
		const sum = statement.rows.reduce((a, r) => a + r.amountMinor, 0n);
		expect(statement.openingBalanceMinor! + sum).toBe(statement.closingBalanceMinor);

		const credits = statement.rows
			.filter((r) => r.amountMinor > 0n)
			.reduce((a, r) => a + r.amountMinor, 0n);
		const debits = statement.rows
			.filter((r) => r.amountMinor < 0n)
			.reduce((a, r) => a - r.amountMinor, 0n);
		expect(credits).toBe(statement.statedCreditTotalMinor);
		expect(debits).toBe(statement.statedDebitTotalMinor);
	});

	it('does not invent a row count the format never prints', () => {
		// Setting statedRowCount from rows.length would compare the rows against
		// themselves — evidence that proves nothing while looking like proof.
		expect(statement.statedRowCount).toBeUndefined();
	});

	it('returns one statement per 074 block, which is how ABO carries several accounts', () => {
		const two = parseAbo(
			[
				header({
					account: ACCOUNT,
					openingDate: '010325',
					opening: 1000,
					closing: 1000,
					debitTurnover: 0,
					creditTurnover: 0,
					bookingDate: '310325'
				}),
				movement({
					account: ACCOUNT,
					counterAccount: '0000002500834780',
					amount: 0,
					code: '2',
					valueDate: '030325'
				}),
				header({
					account: '0000001011097041',
					openingDate: '010325',
					opening: 2000,
					closing: 2000,
					debitTurnover: 0,
					creditTurnover: 0,
					bookingDate: '310325'
				})
			].join('\n')
		);
		expect(two).toHaveLength(2);
		expect(two[0].rows).toHaveLength(1);
		expect(two[1].rows).toHaveLength(0);
	});

	it('refuses a file with no 074 record rather than returning nothing', () => {
		expect(() => parseAbo('nonsense\n')).toThrow(/074/);
	});
});
