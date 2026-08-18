import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ocrAvailable, ocrPdf, renderPdfPages } from '$lib/server/import/ocr';
import { gridsFromRhythm } from '$lib/server/import/tabular/rhythm';
import { chooseGrid, detectRegions } from '$lib/server/import/tabular/regions';
import { readTabular } from '$lib/server/import/tabular/statement';
import { proveStatement } from '$lib/server/import/proof';

/**
 * Reading a statement from pixels, end to end.
 *
 * This capability was recorded as broken through two separate measurements, and
 * both times the recognition was already perfect — what stood in the way was
 * this repository's own handling of what came back. Those two defects are what
 * this suite exists to keep fixed, because neither of them fails loudly: the
 * text is right either way, and only the table falls apart.
 */
const SOURCE = resolve('tests/fixtures/synthetic/pdf-text/statement-001.pdf');
const EXPECTED = resolve('tests/fixtures/synthetic/expected/statement-001.json');
const runnable = ocrAvailable() && existsSync(SOURCE);

describe.skipIf(!runnable)('reading a rendered statement', () => {
	it('recovers every movement exactly, from pixels alone', async () => {
		const truth = JSON.parse(readFileSync(EXPECTED, 'utf8'));
		const bytes = new Uint8Array(readFileSync(SOURCE));

		const lines = await ocrPdf(bytes, ['eng'], { dpi: 300, maxPages: 1 });

		// Cells, not words. A text layer emits "Cash withdrawal / Vector Mobile"
		// as one item and every reader clusters cells into columns by their edges;
		// handing over five separate words made five columns out of one
		// description and tore the table apart.
		const description = lines
			.flatMap((line) => line.cells)
			.find((cell) => cell.startsWith('Cash withdrawal'));
		expect(description).toBe('Cash withdrawal / Vector Mobile');

		const grids = gridsFromRhythm(lines);
		const choice = chooseGrid(grids);
		expect(choice, 'no table was recovered from the page').toBeTruthy();

		// Reading order, which means the column header sits above the movements.
		// Tesseract's y grows downward and a PDF's grows upward: handed over raw,
		// the page arrives upside down, the header is looked for below the first
		// movement instead of above it, and a Debit/Credit pair then reads as one
		// amount column with half its rows empty.
		expect(choice!.grid.rows[0].map((cell) => cell.text)).toContain('Balance');

		const reading = readTabular(choice!, choice!.transactions[0], {
			currency: truth.currency,
			evidenceRegions: grids.flatMap(detectRegions)
		});
		expect(reading.questions.map((question) => question.reason)).toEqual([]);

		const statement = reading.statement!;
		const net = (amount: bigint, fee?: bigint) => amount - (fee ?? 0n);
		expect(statement.rows.map((row) => net(row.amountMinor, row.feeMinor))).toEqual(
			truth.rows.map((row: { amountMinor: string; feeMinor?: string }) =>
				net(BigInt(row.amountMinor), BigInt(row.feeMinor ?? 0))
			)
		);

		// And it proves itself the same way any other reading has to.
		expect(proveStatement(statement, { currency: truth.currency }).proofClass).toBe('P3');
	}, 120_000);

	it('renders a page at the resolution it was asked for', async () => {
		const [png] = await renderPdfPages(new Uint8Array(readFileSync(SOURCE)), 300, 1);
		// PNG signature, then IHDR width — an A4 page at 300 dpi is ~2480 across.
		expect(Buffer.from(png.subarray(1, 4)).toString('ascii')).toBe('PNG');
		expect(Buffer.from(png).readUInt32BE(16)).toBeGreaterThan(2000);
	}, 60_000);
});
