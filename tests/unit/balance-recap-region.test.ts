import { describe, expect, it } from 'vitest';
import { detectAndParseAll } from '$lib/server/import/detect';
import { accountsForWholeFile } from '$lib/server/import/proof';
import type { ParsedRow, ParsedStatement } from '$lib/server/import/types';

const file = (text: string) => new TextEncoder().encode(text);

const row = (amountMinor: bigint, feeMinor?: bigint): ParsedRow =>
	({ bookedAt: '2025-03-01', amountMinor, feeMinor, currency: 'EUR' }) as ParsedRow;

const statement = (
	opening: bigint | undefined,
	closing: bigint | undefined,
	rows: ParsedRow[]
): ParsedStatement =>
	({
		bank: 'tabular',
		currency: 'EUR',
		rows,
		openingBalanceMinor: opening,
		closingBalanceMinor: closing
	}) as ParsedStatement;

/**
 * Whether a reading that already proved can be discarded by a region that did
 * not.
 *
 * Tested here rather than end to end because the defect belongs to the PDF
 * geometry path: a delimited file never produces the second region at all, so a
 * CSV fixture cannot reproduce it however it is arranged. The predicate is the
 * whole of the new decision, and the Komerční banka statement in the acceptance
 * corpus covers the assembled case.
 */
describe('accountsForWholeFile', () => {
	it('vouches for a reading whose movements reach the printed closing balance', () => {
		// 1000,00 + 300,00 - 50,00 - 100,00 = 1150,00
		expect(
			accountsForWholeFile([statement(100000n, 115000n, [row(30000n), row(-5000n), row(-10000n)])])
		).toBe(true);
	});

	it('refuses to vouch when the movements fall short of it', () => {
		// 150,00 is unexplained, so a failing region really might be carrying it.
		expect(
			accountsForWholeFile([statement(100000n, 130000n, [row(30000n), row(-5000n), row(-10000n)])])
		).toBe(false);
	});

	it('treats a fee as part of the movement it belongs to', () => {
		// 1000,00 + (300,00 - 2,00) = 1298,00 — the same convention proveStatement uses.
		expect(accountsForWholeFile([statement(100000n, 129800n, [row(30000n, 200n)])])).toBe(true);
	});

	it('will not vouch for a reading that prints no endpoints', () => {
		// Silence is not evidence: nothing here says whether anything is missing.
		expect(accountsForWholeFile([statement(undefined, undefined, [row(30000n)])])).toBe(false);
		expect(accountsForWholeFile([statement(100000n, undefined, [row(30000n)])])).toBe(false);
	});

	it('will not vouch when nothing read at all', () => {
		expect(accountsForWholeFile([])).toBe(false);
	});

	it('requires every reading to close, not just one of them', () => {
		expect(
			accountsForWholeFile([
				statement(100000n, 115000n, [row(15000n)]),
				statement(100000n, 130000n, [row(15000n)])
			])
		).toBe(false);
	});
});

/**
 * The case the whole-reading refusal exists to prevent, which must keep working.
 *
 * The movements do not reach the printed closing balance — 150,00 is
 * unexplained — so filing what read would import part of a statement and record
 * the file's content hash, and the corrected re-upload would then be refused as
 * a duplicate.
 */
const MOVEMENTS_DO_NOT_CLOSE = [
	'Banco Ficticio S.A. — Extracto de cuenta',
	'Saldo inicial;1000,00 EUR',
	'Saldo final;1300,00 EUR',
	'',
	'Fecha;Concepto;Importe',
	'01/03/2025;NOMINA MARZO;300,00',
	'17/03/2025;SUPERMERCADO;-50,00',
	'28/03/2025;ALQUILER;-100,00'
].join('\n');

describe('a statement whose movements do not reach its closing balance', () => {
	it('is refused rather than filed in part', async () => {
		await expect(detectAndParseAll(file(MOVEMENTS_DO_NOT_CLOSE))).rejects.toThrow();
	});
});
