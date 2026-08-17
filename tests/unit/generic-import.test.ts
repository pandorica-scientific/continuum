import { describe, expect, it } from 'vitest';
import { detectAndParseAll } from '$lib/server/import/detect';
import { profileFromReading } from '$lib/server/import/tabular/profile';

const file = (text: string) => new TextEncoder().encode(text);

/**
 * A bank Continuum has never seen: no adapter, no profile, nothing. It gets in
 * only because its own arithmetic vouches for it.
 */
const UNKNOWN_BANK = [
	'Banco Ficticio S.A. — Extracto de cuenta',
	'Cuenta: ES7021000813190201100489',
	'Saldo inicial;1000,00 EUR',
	'Saldo final;1150,00 EUR',
	'Total abonos;300,00 EUR',
	'Total cargos;150,00 EUR',
	'',
	'Fecha;Concepto;Importe;Saldo',
	'01/03/2025;NOMINA MARZO;300,00;1300,00',
	'17/03/2025;SUPERMERCADO;-50,00;1250,00',
	'28/03/2025;ALQUILER;-100,00;1150,00'
].join('\n');

describe('a bank with no adapter at all', () => {
	it('imports when the statement proves itself', async () => {
		const [statement] = await detectAndParseAll(file(UNKNOWN_BANK));
		expect(statement.bank).toBe('tabular');
		expect(statement.rows).toHaveLength(3);
		expect(statement.currency).toBe('EUR');
		expect(statement.openingBalanceMinor).toBe(100000n);
		expect(statement.closingBalanceMinor).toBe(115000n);

		// The proof, not a guess: opening + movements = closing.
		const sum = statement.rows.reduce((a, r) => a + r.amountMinor, 0n);
		expect(statement.openingBalanceMinor! + sum).toBe(statement.closingBalanceMinor);
	});

	it('reads the columns from their Spanish headers', async () => {
		const [statement] = await detectAndParseAll(file(UNKNOWN_BANK));
		expect(statement.rows[0].bookedAt).toBe('2025-03-01');
		expect(statement.rows[0].amountMinor).toBe(30000n);
		expect(statement.rows[0].balanceAfterMinor).toBe(130000n);
		expect(statement.rows[1].description).toBe('SUPERMERCADO');
	});

	it('REFUSES a statement whose balances do not agree with its movements', async () => {
		// One movement altered: every column still looks perfectly sensible.
		const wrong = UNKNOWN_BANK.replace(
			'17/03/2025;SUPERMERCADO;-50,00;1250,00',
			'17/03/2025;SUPERMERCADO;-55,00;1245,00'
		);
		await expect(detectAndParseAll(file(wrong))).rejects.toThrow(/not confidently enough|no bank/i);
	});

	it('REFUSES a statement with no arithmetic to check at all', async () => {
		const noBalances = [
			'Fecha;Concepto;Importe',
			'01/03/2025;NOMINA;300,00',
			'17/03/2025;COMPRA;-50,00',
			'28/03/2025;ALQUILER;-100,00'
		].join('\n');
		await expect(detectAndParseAll(file(noBalances))).rejects.toThrow(
			/not confidently enough|no bank/i
		);
	});

	it('REFUSES when the date order is undecidable, however sound the arithmetic', async () => {
		// Every day and month is 12 or lower, and no period is printed, so
		// 03/04 could be 3 April or 4 March. The balances still close — and that
		// is precisely the case where closing balances are not enough.
		const ambiguous = [
			'Saldo inicial;1000,00 EUR',
			'Saldo final;1150,00 EUR',
			'',
			'Fecha;Concepto;Importe;Saldo',
			'01/03;NOMINA;300,00;1300,00',
			'05/03;COMPRA;-50,00;1250,00',
			'09/03;ALQUILER;-100,00;1150,00'
		].join('\n');
		await expect(detectAndParseAll(file(ambiguous))).rejects.toThrow(/not confidently enough/i);
	});

	it('a confirmed layout answers the question the file cannot', async () => {
		// Every date is 12 or lower and no period is printed, so unaided this is
		// refused. A profile is a person's answer to exactly that question,
		// recorded once.
		const ambiguous = [
			'Saldo inicial;1000,00 EUR',
			'Saldo final;1150,00 EUR',
			'',
			'Fecha;Concepto;Importe;Saldo',
			'01/03/2025;NOMINA;300,00;1300,00',
			'05/03/2025;COMPRA;-50,00;1250,00',
			'09/03/2025;ALQUILER;-100,00;1150,00'
		].join('\n');
		await expect(detectAndParseAll(file(ambiguous))).rejects.toThrow(/not confidently enough/i);

		const saved = profileFromReading({
			id: 'p1',
			name: 'Banco Ficticio',
			source: 'delimited',
			delimiter: ';',
			headers: ['Fecha', 'Concepto', 'Importe', 'Saldo'],
			roles: ['bookingDate', 'description', 'amount', 'balance'],
			dateOrder: 'day-first',
			decimalMark: ','
		});
		const [statement] = await detectAndParseAll(file(ambiguous), {
			profiles: async () => [saved]
		});
		expect(statement.rows).toHaveLength(3);
		expect(statement.rows[0].bookedAt).toBe('2025-03-01');
	});

	it('does not let a confirmed layout excuse numbers read at the wrong scale', async () => {
		// A profile says what the columns MEAN. It cannot vouch for amounts
		// carrying more decimals than the currency has, so the lexical gate
		// stands whatever the profile says.
		// HUF has no minor unit, so a two-decimal forint amount is money-shaped
		// but cannot be a forint figure — the scale is wrong.
		const overPrecise = [
			'Saldo inicial;1000,00 HUF',
			'Saldo final;1150,00 HUF',
			'',
			'Fecha;Concepto;Importe;Saldo',
			'01/03/2025;NOMINA;300,00;1300,00',
			'05/03/2025;COMPRA;-50,00;1250,00',
			'09/03/2025;ALQUILER;-100,00;1150,00'
		].join('\n');
		const saved = profileFromReading({
			id: 'p2',
			name: 'Banco Ficticio',
			source: 'delimited',
			delimiter: ';',
			headers: ['Fecha', 'Concepto', 'Importe', 'Saldo'],
			roles: ['bookingDate', 'description', 'amount', 'balance'],
			dateOrder: 'day-first',
			decimalMark: ','
		});
		await expect(
			detectAndParseAll(file(overPrecise), { profiles: async () => [saved] })
		).rejects.toThrow(/not confidently enough/i);
	});

	it('does not divert a file a real adapter already handles', async () => {
		// Fio's own export must still be read by Fio's adapter, not generically.
		const fio = [
			'"Výpis č. 7/2026 z účtu ""2500834780/2010"""',
			'"Období: 01.07.2026 - 31.07.2026"',
			'"Počáteční stav účtu k 01.07.2026: 100,00 CZK"',
			'"Koncový stav účtu k 31.07.2026: 50,00 CZK"',
			'',
			'"ID operace";"Datum";"Objem";"Měna"',
			'"27737637241";"04.07.2026";"-50";"CZK"'
		].join('\n');
		const [statement] = await detectAndParseAll(file(fio));
		expect(statement.bank).toBe('fio');
	});
});
