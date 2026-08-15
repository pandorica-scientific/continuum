import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { parseFio } from '$lib/server/import/adapters/fio';
import { parseRevolut } from '$lib/server/import/adapters/revolut';
import { parseMbank } from '$lib/server/import/adapters/mbank';
import { parseRbLines } from '$lib/server/import/adapters/rb';
import { parseCsLines } from '$lib/server/import/adapters/cs';
import { fingerprintAll } from '$lib/server/import/fingerprint';
import type { PdfLine } from '$lib/server/import/types';

const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;

describe('Fio adapter', () => {
	const statement = parseFio(readFileSync(fixture('fio.csv'), 'utf-8'));

	it('reads account, period and balances from the header', () => {
		expect(statement.accountNumber).toBe('1234567890/2010');
		expect(statement.currency).toBe('CZK');
		expect(statement.periodStart).toBe('2026-07-01');
		expect(statement.periodEnd).toBe('2026-07-31');
		expect(statement.openingBalanceMinor).toBe(38238n);
		expect(statement.closingBalanceMinor).toBe(2298438n);
	});

	it('reads every row with bank references and payment symbols', () => {
		expect(statement.rows).toHaveLength(5);
		const first = statement.rows[0];
		expect(first.bookedAt).toBe('2026-07-04');
		expect(first.amountMinor).toBe(-5000n);
		expect(first.counterpartyAccount).toBe('98765432/5500');
		expect(first.bankRef).toBe('27721834815');
		const symbols = statement.rows.find((r) => r.specificSymbol === '224')!;
		expect(symbols.variableSymbol).toBe('9353181662');
	});

	it('reconciles: opening + sum of rows = closing', () => {
		const sum = statement.rows.reduce((s, r) => s + r.amountMinor, 0n);
		expect(statement.openingBalanceMinor! + sum).toBe(statement.closingBalanceMinor);
	});
});

describe('Revolut adapter', () => {
	const statement = parseRevolut(readFileSync(fixture('revolut.csv'), 'utf-8'));

	it('keeps only completed rows and reads amounts', () => {
		expect(statement.rows).toHaveLength(7);
		expect(statement.rows[0].amountMinor).toBe(-5391n);
		expect(statement.rows[0].counterparty).toBe('Fresh Point');
	});

	it('keeps the fee separate and gross amounts intact', () => {
		const withFee = statement.rows.find((r) => r.feeMinor !== undefined)!;
		expect(withFee.amountMinor).toBe(-5660n);
		expect(withFee.feeMinor).toBe(2117n);
	});

	it('records the started date as the value date', () => {
		const boundary = statement.rows.find((r) => r.counterparty === 'Fresh Point')!;
		expect(boundary.bookedAt).toBe('2026-07-01');
		expect(boundary.valueDate).toBe('2026-06-30');
	});

	it('tells identical same-day payments apart via the running balance', () => {
		const prints = fingerprintAll(statement.rows);
		expect(new Set(prints).size).toBe(prints.length);
	});
});

describe('mBank adapter', () => {
	const bytes = readFileSync(fixture('mbank.csv'));
	const statement = parseMbank(iconv.decode(bytes, 'win1250'));

	it('reads metadata from the windows-1250 header', () => {
		expect(statement.currency).toBe('PLN');
		expect(statement.accountNumber).toBe('89 1140 2004 0000 3502 9999 0193');
		expect(statement.openingBalanceMinor).toBe(6793n);
		expect(statement.closingBalanceMinor).toBe(10659n);
	});

	it('reads rows with running balances and polish diacritics intact', () => {
		expect(statement.rows).toHaveLength(5);
		expect(statement.rows[2].description).toContain('ZAKUP PRZY UŻYCIU KARTY');
		expect(statement.rows[0].balanceAfterMinor).toBe(22293n);
	});

	it('keeps the operation date as the value date', () => {
		const feeRow = statement.rows[4]; // booked 07-21, operation 07-20
		expect(feeRow.bookedAt).toBe('2026-07-21');
		expect(feeRow.valueDate).toBe('2026-07-20');
	});

	it('identical express transfers get distinct fingerprints', () => {
		const prints = fingerprintAll(statement.rows);
		expect(new Set(prints).size).toBe(prints.length);
	});

	it('reconciles: opening + sum of rows = closing', () => {
		const sum = statement.rows.reduce((s, r) => s + r.amountMinor, 0n);
		expect(statement.openingBalanceMinor! + sum).toBe(statement.closingBalanceMinor);
	});
});

describe('Raiffeisenbank PDF adapter', () => {
	const lines = JSON.parse(readFileSync(fixture('rb-lines.json'), 'utf-8')) as PdfLine[];
	const statement = parseRbLines(lines);

	it('reads header facts', () => {
		expect(statement.accountNumber).toBe('98765432/5500');
		expect(statement.openingBalanceMinor).toBe(3124243n);
		expect(statement.closingBalanceMinor).toBe(4350295n);
		expect(statement.periodStart).toBe('2026-07-01');
	});

	it('reads movements with references', () => {
		expect(statement.rows).toHaveLength(5);
		const first = statement.rows[0];
		expect(first.bookedAt).toBe('2026-07-02');
		expect(first.amountMinor).toBe(-100000n);
		expect(first.counterpartyAccount).toBe('6850057/2700');
		expect(first.bankRef).toBe('9181392568');
	});

	it('prefers the merchant line for card payments', () => {
		const card = statement.rows.find((r) => r.amountMinor === -249900n);
		expect(card?.counterparty).toBe('ZOOPLUS');
	});

	it('finds the reference and merchant however many detail lines precede them', () => {
		// The Apple Pay row pushes its "PK:" marker onto a line of its own, so
		// the transaction code lands at i+3 and the merchant line at i+4. Read
		// at a fixed stride (code at i+2, merchant within i+3) this row lost
		// both: no reference, and no counterparty for any rule to match.
		const applePay = statement.rows.find((r) => r.amountMinor === -4444n);
		expect(applePay?.bankRef).toBe('9198541942');
		expect(applePay?.counterparty).toBe('ALBERT VAM DEKUJE');
		expect(applePay?.valueDate).toBe('2026-07-05');
	});

	it('gives every movement a bank reference', () => {
		expect(statement.rows.filter((r) => !r.bankRef)).toHaveLength(0);
	});

	it('reads incoming amounts with plus signs', () => {
		const incoming = statement.rows.find((r) => r.amountMinor > 0n);
		expect(incoming?.amountMinor).toBe(1000000n);
		expect(incoming?.counterpartyAccount).toBe('1234567890/2010');
	});
});

describe('Česká spořitelna PDF adapter', () => {
	const lines = JSON.parse(readFileSync(fixture('cs-lines.json'), 'utf-8')) as PdfLine[];
	const statement = parseCsLines(lines);

	it('reads header facts', () => {
		expect(statement.accountNumber).toBe('1122334455/0800');
		expect(statement.openingBalanceMinor).toBe(11482044n);
		expect(statement.closingBalanceMinor).toBe(6746739n);
	});

	it('reads movements with counter-accounts and references', () => {
		expect(statement.rows).toHaveLength(5);
		const standing = statement.rows[0];
		expect(standing.amountMinor).toBe(-1925800n);
		expect(standing.counterpartyAccount).toBe('1001012489/5500');
		expect(standing.variableSymbol).toBe('3004014133');
	});

	it('uses instruction numbers as bank references when present', () => {
		const saving = statement.rows.find((r) => r.amountMinor === -780n);
		expect(saving?.bankRef).toBe('2000026391448011');
	});

	it('does not read a card row transaction date as a variable symbol', () => {
		// "01.06.2026 | Platba kartou | 30052026 | -1 202.20" — the middle cell
		// is d.tran.30.05.2026 compressed, not a payment symbol. Rules match on
		// variableSymbol, so inventing one here would let a rule keyed to a real
		// symbol silently file unrelated card payments.
		const card = statement.rows.find((r) => r.amountMinor === -120220n);
		expect(card?.variableSymbol).toBeUndefined();
		expect(card?.valueDate).toBe('2026-05-30');
		// The genuine symbols on transfer rows are still read.
		expect(statement.rows.find((r) => r.amountMinor === -48000n)?.variableSymbol).toBe('45628997');
	});

	it('identical-looking rows still fingerprint uniquely', () => {
		const prints = fingerprintAll(statement.rows);
		expect(new Set(prints).size).toBe(prints.length);
	});
});
