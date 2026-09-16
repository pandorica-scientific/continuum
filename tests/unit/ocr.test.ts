import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ocrAvailable, renderPdfPages } from '$lib/server/ocr';
import { ocrPdf } from '$lib/server/import/ocr';
import { gridsFromRhythm } from '$lib/server/import/tabular/rhythm';
import { chooseGrid, detectRegions } from '$lib/server/import/tabular/regions';
import { readTabular } from '$lib/server/import/tabular/statement';
import { proveStatement } from '$lib/server/import/proof';

/**
 * Reading a statement from pixels, end to end. Guards against table-reconstruction
 * defects that don't fail loudly — the recognized text is right either way.
 */
const SOURCE = resolve('tests/fixtures/synthetic/pdf-text/statement-001.pdf');
const EXPECTED = resolve('tests/fixtures/synthetic/expected/statement-001.json');
const runnable = ocrAvailable() && existsSync(SOURCE);

describe.skipIf(!runnable)('reading a rendered statement', () => {
	it('recovers every movement exactly, from pixels alone', async () => {
		const truth = JSON.parse(readFileSync(EXPECTED, 'utf8'));
		const bytes = new Uint8Array(readFileSync(SOURCE));

		const lines = await ocrPdf(bytes, ['eng'], { dpi: 300, maxPages: 1 });

		// Cells, not words: the reader clusters cells into columns by their edges, so five
		// separate words would make five columns out of one description.
		const description = lines
			.flatMap((line) => line.cells)
			.find((cell) => cell.startsWith('Cash withdrawal'));
		expect(description).toBe('Cash withdrawal / Vector Mobile');

		const grids = gridsFromRhythm(lines);
		const choice = chooseGrid(grids);
		expect(choice, 'no table was recovered from the page').toBeTruthy();

		// Tesseract's y grows downward and a PDF's grows upward; handed over raw, the page
		// arrives upside down with the header below the movements instead of above.
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
