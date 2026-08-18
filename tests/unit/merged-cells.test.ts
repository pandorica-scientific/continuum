import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { gridsFromWorkbook } from '$lib/server/import/tabular/grid';

/**
 * A workbook where one heading is written across two columns.
 *
 * The file stores a merged value in the top-left cell and leaves the rest
 * empty, so without expansion the header row arrives as a label followed by a
 * blank — the detector counts one named column where the sheet shows two, and
 * the second loses its name.
 */
function workbook(merge: XLSX.Range, rows: unknown[][]): Uint8Array {
	const sheet = XLSX.utils.aoa_to_sheet(rows);
	sheet['!merges'] = [merge];
	const book = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(book, sheet, 'Statement');
	return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }));
}

const textOf = (bytes: Uint8Array, row: number) =>
	gridsFromWorkbook(bytes)[0].rows[row].map((cell) => cell.text);

describe('merged cells in a workbook', () => {
	it('spreads a heading written across columns', () => {
		const bytes = workbook({ s: { r: 0, c: 1 }, e: { r: 0, c: 2 } }, [
			['Date', 'Amount', null],
			['2026-03-14', '100.00', '']
		]);
		// Both columns the heading spans now carry it.
		expect(textOf(bytes, 0)).toEqual(['Date', 'Amount', 'Amount']);
	});

	it('never spreads a value merged down rows', () => {
		// A merge across columns is a label written wide. A merge DOWN rows is one
		// value applying to a group, and copying it into each of them would
		// manufacture data — a date repeated onto movements that never carried
		// one, which the reader would then file without hesitation.
		const bytes = workbook({ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }, [
			['Date', 'Amount'],
			['2026-03-14', '100.00'],
			[null, '250.00']
		]);
		expect(textOf(bytes, 2)).toEqual(['', '250.00']);
	});

	it('never writes over a value the sheet actually holds', () => {
		const bytes = workbook({ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }, [
			['Movements', 'Balance'],
			['100.00', '900.00']
		]);
		expect(textOf(bytes, 0)).toEqual(['Movements', 'Balance']);
	});
});
