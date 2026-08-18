import { describe, expect, it } from 'vitest';
import { gridFromText, repairedGrids } from '$lib/server/import/tabular/grid';
import { detectAndParseAll } from '$lib/server/import/detect';

const encode = (text: string) => new TextEncoder().encode(text);
const texts = (grid: { rows: { text: string }[][] }, row: number) =>
	grid.rows[row].map((cell) => cell.text);

/**
 * A delimited file whose delimiter is also its decimal mark.
 *
 * `799,56` is indistinguishable from two fields `799` and `56` by any reader
 * that only looks at the text — and an unquoted comma inside a description does
 * the same thing for a different reason. What settles it is not the text but
 * the statement's own balances, so the rejoined reading is offered as one more
 * CANDIDATE and kept only if it proves itself.
 */
describe('rejoining fields that split on the decimal mark', () => {
	it('is offered as a candidate, never as a replacement', () => {
		const grid = gridFromText('a,b\n1,00,2,00\n', ',');
		const repaired = repairedGrids(grid);
		expect(repaired).toHaveLength(1);
		// The original survives untouched beside it.
		expect(texts(grid, 1)).toEqual(['1', '00', '2', '00']);
		expect(texts(repaired[0], 1)).toEqual(['1,00', '2,00']);
		expect(repaired[0].origin).toContain('rejoined');
	});

	it('leaves a well-formed file alone', () => {
		const grid = gridFromText('date,amount\n2026-01-01,100.00\n', ',');
		expect(repairedGrids(grid)).toEqual([]);
	});

	it('does not weld two genuinely separate columns together', () => {
		// The right half must be exactly the fractional digits. A reference beside
		// an amount would otherwise become one number that happens to parse.
		const grid = gridFromText('ref,amount\n12345,1000\n', ',');
		expect(repairedGrids(grid)).toEqual([]);
	});

	it('reads a comma-on-comma statement, and gets the amounts right', async () => {
		// The cents have to matter for the arithmetic to be able to choose.
		//
		// Dropping them from the amount AND the balance together leaves a chain
		// that still closes — 6127 - 425 = 5702 exactly as 6127.92 - 425.23 =
		// 5702.69 does — so the broken reading is not always distinguishable from
		// the repaired one. What separates them is a borrow across the decimal
		// point: 6127.92 - 425.99 = 5701.93, while the truncated figures give
		// 5702. Over a real statement that happens within the first few
		// movements; over three hand-picked ones it has to be arranged.
		// The real shape: a booking date, a value date, a description, the amount
		// and the running balance — the last two both splitting on the delimiter.
		const csv = [
			'#Data ksiegowania,#Data operacji,#Opis operacji,#Kwota,#Saldo po operacji',
			'2026-06-20,2026-06-19,Refund Harbour Energy,799,56,6127,92',
			'2026-06-22,,Bank service fee Summit,-425,99,5701,93',
			'2026-06-24,,Card purchase Northstar,-50,49,5651,44'
		].join('\n');
		const [statement] = await detectAndParseAll(encode(csv), { currency: 'PLN' });
		expect(statement.rows.map((row) => row.amountMinor)).toEqual([79_956n, -42_599n, -5_049n]);
		expect(statement.rows.map((row) => row.balanceAfterMinor)).toEqual([
			612_792n,
			570_193n,
			565_144n
		]);
		// And the reading says how it was arrived at.
		expect(statement.provenance?.method).toContain('rejoined');
	});

	it('refuses a rejoining that the balances do not support', async () => {
		// The same shape with a balance chain that does not follow. The repair is
		// still generated; it simply cannot prove itself, and nothing else can
		// read the file either.
		const csv = [
			'#Data,#Opis,#Kwota,#Saldo',
			'2026-06-20,Refund,799,56,6127,92',
			'2026-06-22,Fee,-425,23,9999,99',
			'2026-06-24,Card,-50,49,1111,11'
		].join('\n');
		await expect(detectAndParseAll(encode(csv), { currency: 'PLN' })).rejects.toThrow();
	});
});
