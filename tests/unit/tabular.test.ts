import { describe, expect, it } from 'vitest';
import {
	candidateGrids,
	decodeCandidates,
	delimiterCandidates,
	gridFromText
} from '$lib/server/import/tabular/grid';
import { chooseGrid, detectRegions, transactionRows } from '$lib/server/import/tabular/regions';
import { normalise } from '$lib/server/import/tabular/vocabulary';
import { looksLikeSummary, roleOfHeader } from '$lib/server/import/tabular/vocabulary';

/**
 * The shape of a real mBank export, reduced but structurally faithful: a long
 * key/value preamble, a turnover summary, an opening balance, the movements,
 * and a closing balance sharing the movements' width.
 */
const MBANK = [
	'mBank S.A. Bankowość Detaliczna;',
	'\t\tSkrytka Pocztowa 2108;',
	'',
	'#Klient;',
	'ROBERT KIEWISZ;',
	'',
	'#Waluta;',
	'PLN;',
	'',
	'#Podsumowanie obrotów na rachunku;#Liczba operacji;#Wartość operacji',
	'Uznania;2;310,00 PLN;',
	'Obciążenia;3;271,34 PLN;',
	'',
	'#Saldo początkowe;67,93 PLN;',
	'',
	'#Data księgowania;#Data operacji;#Opis operacji;#Kwota;#Saldo po operacji;',
	'2026-07-04;2026-07-04;PRZELEW PRZYCH.;10,00;77,93;',
	'2026-07-04;2026-07-04;PRZELEW PRZYCH.;300,00;377,93;',
	'2026-07-05;2026-07-05;ZAKUP KARTĄ;-240,00;137,93;',
	'2026-07-20;2026-07-20;BLIK ZAKUP;-21,34;116,59;',
	'2026-07-21;2026-07-20;OPŁATA ZA KARTĘ;-10,00;106,59;',
	';;;#Saldo końcowe;106,59 PLN;',
	'',
	'Niniejszy dokument sporządzono na podstawie art. 7 Ustawy Prawo Bankowe.'
].join('\n');

describe('vocabulary', () => {
	it('maps header labels to roles across languages', () => {
		expect(roleOfHeader('#Kwota')).toBe('amount');
		expect(roleOfHeader('Částka')).toBe('amount');
		expect(roleOfHeader('Betrag')).toBe('amount');
		expect(roleOfHeader('Importe')).toBe('amount');
		expect(roleOfHeader('Saldo po operacji')).toBe('balance');
		expect(roleOfHeader('Paid out')).toBe('debit');
	});

	it('prefers the longer, more specific term', () => {
		// "data operacji" is the value date; plain "data" is the booking date.
		expect(roleOfHeader('#Data operacji')).toBe('valueDate');
		expect(roleOfHeader('#Data księgowania')).toBe('bookingDate');
	});

	it('is accent- and case-insensitive', () => {
		expect(roleOfHeader('CASTKA')).toBe('amount');
		expect(looksLikeSummary('Počáteční zůstatek: 35 971,21')).toBe(true);
	});

	it('does not match a term buried inside another word', () => {
		expect(roleOfHeader('Datenschutz')).toBeUndefined();
	});
});

describe('decoding and delimiters', () => {
	it('prefers the encoding that produces real diacritics, not replacements', () => {
		const win1250 = Buffer.from('Zakup kartą;Częstochowa\n', 'latin1');
		// Bytes that are valid win1250 but invalid UTF-8.
		const bytes = new Uint8Array([0x5a, 0x61, 0x6b, 0x75, 0x70, 0x20, 0xb9, 0x3b, 0xea, 0x0a]);
		expect(decodeCandidates(bytes)[0].encoding).not.toBe('utf-8');
		expect(win1250.length).toBeGreaterThan(0);
	});

	it('ignores single-column preamble lines when ranking delimiters', () => {
		// Eight preamble lines and three table lines: the table must still win.
		const lines = [
			'"Výpis č. 7/2026"',
			'"Majitel účtu: Kdosi"',
			'"Období: 01.07.2026 - 31.07.2026"',
			'a;b;c;d',
			'1;2;3;4',
			'5;6;7;8'
		];
		const [best] = delimiterCandidates(lines);
		expect(best.delimiter).toBe(';');
		expect(best.columns).toBe(4);
	});
});

describe('region detection', () => {
	const grid = gridFromText(MBANK, ';');
	const regions = detectRegions(grid);

	it('finds the transaction table even though it is not the dominant width', () => {
		const transactions = regions.filter((r) => r.role === 'transactions');
		expect(transactions).toHaveLength(1);
		expect(transactions[0].width).toBeGreaterThanOrEqual(5);
	});

	it('keeps the summary regions as evidence rather than discarding them', () => {
		const summaries = regions.filter((r) => r.role === 'summary');
		const text = summaries.map((r) =>
			r.rows.map((row) => row.map((c) => c.text).join(' ')).join(' ')
		);
		expect(text.join(' ')).toMatch(/Saldo początkowe/);
		expect(text.join(' ')).toMatch(/Uznania/);
	});

	it('recognises the legal footer', () => {
		expect(regions.some((r) => r.role === 'footer')).toBe(true);
	});

	it('files the closing-balance row as evidence rather than as a movement', () => {
		// mBank prints its closing balance in a row the same width as a movement
		// and directly below them, which is why a width-based reader imports it as
		// a transaction that does not exist.
		//
		// It used to be caught inside the transaction region and filtered out
		// there, which kept it from being imported but also threw it away. Now the
		// region split notices that it fills different columns and gives it a
		// region of its own, where it is read for what it is — the statement's own
		// closing balance, and therefore something the arithmetic can check the
		// movements against.
		const table = regions.find((r) => r.role === 'transactions')!;
		expect(transactionRows(table)).toHaveLength(5);

		const summaries = regions
			.filter((r) => r.role === 'summary')
			.map((r) => r.rows.map((row) => row.map((c) => c.text).join(' ')).join(' '));
		expect(summaries.join(' ')).toMatch(/Saldo końcowe/);
	});

	it('identifies the header row', () => {
		const table = regions.find((r) => r.role === 'transactions')!;
		expect(table.headerIndex).toBe(0);
		expect(roleOfHeader(table.rows[0][4].text)).toBe('balance');
	});
});

describe('choosing between readings', () => {
	it('picks the delimiter that yields an actual transaction table', () => {
		const choice = chooseGrid(candidateGrids(new TextEncoder().encode(MBANK)))!;
		expect(choice.grid.delimiter).toBe(';');
		expect(choice.transactions).toHaveLength(1);
		expect(transactionRows(choice.transactions[0])).toHaveLength(5);
	});

	it('returns nothing rather than guessing when no reading yields movements', () => {
		expect(chooseGrid(candidateGrids(new TextEncoder().encode('just;a;header\n')))).toBeNull();
	});

	it('reads ungrouped integer amounts, which is how Fio prints whole crowns', () => {
		// Requiring a thousands separator dropped three of six real movements
		// while a fixture using "240,00" passed — the amounts a bank writes
		// plainly are still amounts.
		const ungrouped = [
			'"ID operace";"Datum";"Objem";"Měna"',
			'"27737637241";"14.07.2026";"-20000";"CZK"',
			'"27739985974";"15.07.2026";"32892";"CZK"',
			'"27749380245";"21.07.2026";"-50";"CZK"'
		].join('\n');
		const table = detectRegions(gridFromText(ungrouped, ';')).find(
			(r) => r.role === 'transactions'
		)!;
		expect(transactionRows(table)).toHaveLength(3);
	});

	it('handles a file whose transaction table has no header at all', () => {
		const headerless = [
			'01.03.2025;-10,00;90,00',
			'02.03.2025;-5,00;85,00',
			'03.03.2025;20,00;105,00'
		].join('\n');
		const table = detectRegions(gridFromText(headerless, ';')).find(
			(r) => r.role === 'transactions'
		)!;
		expect(table.headerIndex).toBeUndefined();
		expect(transactionRows(table)).toHaveLength(3);
	});
});

describe('reading a statement from a grid', () => {
	it('reads the value beside a label cell-wise, not from the joined row', async () => {
		const { readEvidence } = await import('$lib/server/import/tabular/statement');
		// mBank writes "Uznania;2;310,00 PLN". Joined to text that reads
		// "2 310,00" — a perfectly good space-grouped number — and the operation
		// count silently merges into the value, ten times too large.
		const grid = gridFromText(
			[
				'#Podsumowanie;#Liczba operacji;#Wartość',
				'Uznania;2;310,00 PLN',
				'Obciążenia;3;271,34 PLN'
			].join('\n'),
			';'
		);
		const evidence = readEvidence(detectRegions(grid));
		expect(evidence.creditTotal).toBe('310,00');
		expect(evidence.debitTotal).toBe('271,34');
	});

	it('resolves the decimal mark from the balances when the amounts cannot settle it', async () => {
		const { readTabular } = await import('$lib/server/import/tabular/statement');
		// Fio's movements are ungrouped integers that settle nothing; its balance
		// line reads "382,38". Consulting only the columns picked "." and turned
		// that balance into 38 238,00.
		const fio = [
			'"Počáteční stav účtu k 01.07.2026: 382,38 CZK"',
			'"Koncový stav účtu k 31.07.2026: 12984,38 CZK"',
			'',
			'"Datum";"Objem";"Měna"',
			'"04.07.2026";"-50";"CZK"',
			'"13.07.2026";"29760";"CZK"'
		].join('\n');
		const choice = chooseGrid(candidateGrids(new TextEncoder().encode(fio)))!;
		const reading = readTabular(choice, choice.transactions[0]);
		expect(reading.decimalMark).toBe(',');
		expect(reading.statement?.openingBalanceMinor).toBe(38238n);
		expect(reading.statement?.closingBalanceMinor).toBe(1298438n);
	});

	it('asks about the date order rather than guessing when nothing settles it', async () => {
		const { readTabular } = await import('$lib/server/import/tabular/statement');
		const ambiguous = [
			'Date;Description;Amount',
			'03/04;Payroll;2480.00',
			'03/07;Groceries;-92.34',
			'03/11;Cash;-200.00'
		].join('\n');
		const choice = chooseGrid(candidateGrids(new TextEncoder().encode(ambiguous)))!;
		const reading = readTabular(choice, choice.transactions[0]);
		expect(reading.statement).toBeUndefined();
		expect(reading.questions.map((q) => q.dimension)).toContain('dateOrder');
	});

	it('takes direction from which column holds the value, for a debit/credit pair', async () => {
		const { readTabular } = await import('$lib/server/import/tabular/statement');
		const uk = [
			'Date;Description;Paid out;Paid in;Balance',
			'02/04/2025;SALARY;;2850.00;4995.80',
			'03/04/2025;BRITISH GAS;88.40;;4907.40',
			'17/04/2025;J SMITH;;120.00;5027.40'
		].join('\n');
		const choice = chooseGrid(candidateGrids(new TextEncoder().encode(uk)))!;
		// The account supplies the currency: this fixture prints none, and a
		// reader that invented one would be the bug this argument exists to stop.
		const reading = readTabular(choice, choice.transactions[0], { currency: 'GBP' });
		const rows = reading.statement!.rows;
		expect(rows[0].amountMinor).toBe(285000n);
		expect(rows[1].amountMinor).toBe(-8840n);
		expect(rows[2].amountMinor).toBe(12000n);
	});
});

describe('the vocabulary itself', () => {
	it('never lists one term under two roles', async () => {
		// A duplicated term makes the winning role depend on object key order,
		// which is how Spanish "Concepto" silently became a counterparty name
		// instead of the description it actually is.
		const { HEADER_TERMS } = await import('$lib/server/import/tabular/vocabulary');
		const seen = new Map<string, string>();
		const clashes: string[] = [];
		for (const [role, terms] of Object.entries(HEADER_TERMS)) {
			for (const term of terms) {
				const existing = seen.get(term);
				if (existing) clashes.push(`"${term}" is both ${existing} and ${role}`);
				else seen.set(term, role);
			}
		}
		expect(clashes).toEqual([]);
	});
});

describe('vocabulary folding', () => {
	it('folds Polish stroked letters, which NFD cannot decompose', () => {
		// Every Polish term in the dictionary is written plainly, so a `ł` that
		// survives normalisation means the entry can never match: `Łącznie` never
		// marked a summary line, and `Opłata` never named a fee column.
		expect(normalise('Łącznie')).toBe('lacznie');
		expect(normalise('Opłata')).toBe('oplata');
	});
});
