import { describe, expect, it } from 'vitest';
import {
	candidateGrids,
	decodeCandidates,
	delimiterCandidates,
	gridFromText
} from '$lib/server/import/tabular/grid';
import {
	chooseGrid,
	detectRegions,
	excludedRows,
	transactionRows
} from '$lib/server/import/tabular/regions';
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

	it('excludes the closing-balance row that shares the transaction width', () => {
		const table = regions.find((r) => r.role === 'transactions')!;
		const rows = transactionRows(table);
		expect(rows).toHaveLength(5);
		// The phantom row is reported, not silently dropped.
		const excluded = excludedRows(table).map((r) => r.map((c) => c.text).join(' '));
		expect(excluded.join(' ')).toMatch(/Saldo końcowe/);
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
