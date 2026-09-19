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
	// The adapter returns a list because Revolut writes every pocket into one
	// file, each with its own running balance — see revolut-pockets.test.ts.
	const [statement] = parseRevolut(readFileSync(fixture('revolut.csv'), 'utf-8'));

	it('keeps only completed rows and reads amounts', () => {
		expect(statement.rows).toHaveLength(9);
		expect(statement.rows[0].amountMinor).toBe(-5391n);
		expect(statement.rows[0].counterparty).toBe('Fresh Point');
	});

	it('keeps the fee separate and gross amounts intact', () => {
		const withFee = statement.rows.find((r) => r.feeMinor !== undefined)!;
		expect(withFee.amountMinor).toBe(-5660n);
		expect(withFee.feeMinor).toBe(2117n);
	});

	it('keeps a refunded fee negative, so the refund is not charged the fee again', () => {
		// Revolut writes the balance as amount - fee throughout, with the fee
		// SIGNED: refunding a payment refunds the fee it was charged with, as
		// -0.98 against the +0.98 on the payment. Normalising that to a magnitude
		// took the fee off twice and broke the running balance on that one row,
		// which was enough to reject a 400-row statement whole.
		const refund = statement.rows.find((r) => r.description === 'Card Refund')!;
		expect(refund.amountMinor).toBe(9841n);
		expect(refund.feeMinor).toBe(-98n);
	});

	it('closes its running balance across a fee charged and then refunded', () => {
		// The whole point of the sign: the chain the proof engine tests is
		// `balance(n) === balance(n-1) + amount - fee`, on every row.
		for (let i = 1; i < statement.rows.length; i++) {
			const previous = statement.rows[i - 1].balanceAfterMinor!;
			const row = statement.rows[i];
			expect(row.balanceAfterMinor).toBe(previous + row.amountMinor - (row.feeMinor ?? 0n));
		}
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
		// The Apple Pay row pushes its "PK:" marker onto its own line, shifting the
		// code to i+3 and merchant to i+4 — a fixed stride would lose both.
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

	it('names a payment by what it was for, not by what KIND of payment it was', () => {
		// ČS prints the kind on the first detail line for some operations —
		// "okamžitá" (instant) here — and what the payment was on the next.
		// Taken as the counterparty, twenty-three unrelated payments to nine
		// different accounts all read "okamžitá" and none could be told apart.
		const instant = statement.rows.find((r) => r.amountMinor === -48000n);
		expect(instant?.counterparty).toBe('QRFA 262082506');
		// Nothing is lost: the kind is still in the description.
		expect(instant?.description).toContain('okamžitá');
	});

	it('names a payment by its message, not by the constant symbol above it', () => {
		// The same mistake one line further along: ČS prints the constant symbol
		// on its own line directly before the message, so three Alza orders were
		// all named "0308" while "OBJEDNAVKA ... NA ALZA.CZ" sat right under it.
		// A payee is never written as digits alone.
		const withSymbol: PdfLine[] = [
			{ page: 1, y: 900, cells: ['Číslo účtu/kód banky: 1122334455/0800'] },
			{ page: 1, y: 890, cells: ['Měna účtu: CZK'] },
			{
				page: 1,
				y: 500,
				cells: ['28.03.2026', 'Tuzemská odchozí úhrada', '2171532/0800', '590111449', '-265.00']
			},
			{ page: 1, y: 490, cells: ['0308'] },
			{ page: 1, y: 480, cells: ['OBJEDNAVKA 590111449 NA ALZA.CZ'] }
		];
		const [row] = parseCsLines(withSymbol).rows;
		expect(row.counterparty).toBe('OBJEDNAVKA 590111449 NA ALZA.CZ');
		// The symbol is not lost, only demoted — it is still in the description.
		expect(row.description).toContain('0308');
	});

	it('falls back to the kind of payment when every detail line is a bare code', () => {
		// A Moneyback row: a constant symbol and then the card number. Neither
		// names anything, so the kind wins — "Moneyback · 0006" at least says
		// what happened, where "0006" alone says nothing at all.
		const allCodes: PdfLine[] = [
			{ page: 1, y: 900, cells: ['Číslo účtu/kód banky: 1122334455/0800'] },
			{ page: 1, y: 890, cells: ['Měna účtu: CZK'] },
			{ page: 1, y: 500, cells: ['05.03.2026', 'Moneyback', '12.50'] },
			{ page: 1, y: 490, cells: ['0006'] },
			{ page: 1, y: 480, cells: ['4405797473'] }
		];
		const [row] = parseCsLines(allCodes).rows;
		expect(row.counterparty).toBe('Moneyback · 0006');
	});

	it('falls back to the kind of payment when there is nothing else to go on', () => {
		// A transfer whose only other detail line is the row's own date. The
		// date would identify it even less than the kind does, so the kind wins.
		const onlyADate: PdfLine[] = [
			{ page: 1, y: 900, cells: ['Číslo účtu/kód banky: 1122334455/0800'] },
			{ page: 1, y: 890, cells: ['Měna účtu: CZK'] },
			{
				page: 1,
				y: 500,
				cells: ['13.02.2026', 'Tuzemská odchozí úhrada', '131-3171230277/0100', '-399 629.09']
			},
			{ page: 1, y: 490, cells: ['okamžitá'] },
			{ page: 1, y: 480, cells: ['13.02.2026'] }
		];
		const [row] = parseCsLines(onlyADate).rows;
		expect(row.counterparty).toBe('Tuzemská odchozí úhrada · okamžitá');
	});

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

describe('Raiffeisenbank PDF adapter — January 2025 template', () => {
	// RB's January layout uses unspaced dates and no colon in the header, unlike March.
	// Regression: a March-only parser silently read zero movements from this statement.
	const lines = JSON.parse(readFileSync(fixture('rb-lines-jan2025.json'), 'utf-8')) as PdfLine[];
	const statement = parseRbLines(lines);

	it('reads every movement despite the unspaced dates', () => {
		expect(statement.rows).toHaveLength(4);
		expect(statement.rows[0].bookedAt).toBe('2025-01-03');
		expect(statement.rows[0].amountMinor).toBe(-610300n);
		expect(statement.rows[0].counterpartyAccount).toBe('1011097041/5500');
		expect(statement.rows[0].bankRef).toBe('7108202415');
	});

	it('reads the period from a header with no colon', () => {
		expect(statement.periodStart).toBe('2025-01-01');
		expect(statement.periodEnd).toBe('2025-01-31');
	});

	it('reconciles: opening + sum of rows = closing', () => {
		const sum = statement.rows.reduce((a, r) => a + r.amountMinor, 0n);
		expect(statement.openingBalanceMinor).toBe(3597121n);
		expect(statement.openingBalanceMinor! + sum).toBe(statement.closingBalanceMinor);
	});

	it('agrees with the totals the statement states for itself', () => {
		const credits = statement.rows
			.filter((r) => r.amountMinor > 0n)
			.reduce((a, r) => a + r.amountMinor, 0n);
		const debits = statement.rows
			.filter((r) => r.amountMinor < 0n)
			.reduce((a, r) => a - r.amountMinor, 0n);
		expect(statement.statedCreditTotalMinor).toBe(1500000n);
		expect(statement.statedDebitTotalMinor).toBe(1151890n);
		expect(credits).toBe(statement.statedCreditTotalMinor);
		expect(debits).toBe(statement.statedDebitTotalMinor);
	});
});

describe('stated totals are captured wherever a bank prints them', () => {
	// Two omitted movements that offset each other leave opening + sum = closing
	// intact, but cannot also leave both stated totals intact.
	it('Raiffeisenbank: Příjmy/Výdaje celkem', () => {
		const s = parseRbLines(
			JSON.parse(readFileSync(fixture('rb-lines.json'), 'utf-8')) as PdfLine[]
		);
		expect(s.statedCreditTotalMinor).toBe(5465000n);
		expect(s.statedDebitTotalMinor).toBe(4238948n);
	});

	it('mBank: Uznania/Obciążenia, with a row count per direction', () => {
		const s = parseMbank(iconv.decode(readFileSync(fixture('mbank.csv')), 'win1250'));
		expect(s.statedCreditTotalMinor).toBeDefined();
		expect(s.statedDebitTotalMinor).toBeDefined();
		expect(s.statedRowCount).toBe(s.rows.length);
	});

	it('Fio: Suma příjmů/výdajů as positive magnitudes', () => {
		const s = parseFio(readFileSync(fixture('fio.csv'), 'utf-8'));
		expect(s.statedDebitTotalMinor).toBeDefined();
		expect(s.statedDebitTotalMinor! >= 0n).toBe(true);
	});
});
