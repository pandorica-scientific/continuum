import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectAndParseAll } from '$lib/server/import/detect';

/**
 * The synthetic corpus: 60 statements, 24 locales, 20 currencies, 16 layout
 * archetypes, each emitted in up to ten formats.
 *
 * It exists because the real samples are the ones the reader was DEVELOPED
 * against, and a reader measured only on those cannot tell competence from
 * memory. When this corpus was first run, eleven of nineteen real files worked
 * and 37 of 294 synthetic ones did.
 *
 * Every file is named, and named in one of two lists: it either reproduces its
 * ground truth exactly — same movements, same currency — or it appears in
 * KNOWN_GAPS with the reason. Both directions fail. A gap that starts working
 * is a failure, because the reason recorded here has become false and someone
 * should say so; that is deliberate, and it is how the list stays honest
 * instead of decaying into an alibi.
 *
 * Scored on `amount - fee`, not `amountMinor`: the ground truth records a fee
 * as a separate field and several parsers fold it in. The ledger effect is what
 * must agree.
 *
 * The currency is supplied the way production supplies it — from the account —
 * because that is the authority, and reading it off the page is what filed a
 * euro statement as koruna.
 *
 * Synthetic throughout: no real financial data, so unlike the private samples
 * this can live in the repository and run in CI.
 */
const ROOT = resolve('tests/fixtures/synthetic');
const present = existsSync(ROOT);

const FORMATS = ['csv', 'tsv', 'pdf-text', 'camt053', 'mt940', 'abo', 'ofx', 'qif', 'xlsx', 'ods'];

interface Gap {
	why: string;
	files: string[];
}

const KNOWN_GAPS: Gap[] = [
	{
		/**
		 * Comma as both delimiter and decimal mark, unquoted: `799,56` is
		 * indistinguishable from two fields `799` and `56`, so the field boundaries
		 * are genuinely ambiguous. Real exports using comma decimals ship semicolons
		 * for exactly this reason. Recoverable only by trying merges against the
		 * balance chain, which is candidate generation we have not built.
		 */
		why: 'Comma as both delimiter and decimal mark, unquoted: `799,56` is indistinguishable from two fields `799` and `56`, so the field boundaries are genuinely ambiguous. Real exports using comma decimals ship semicolons for exactly this reason. Recoverable only by trying merges against the balance chain, which is candidate generation we have not built.',
		files: [
			'csv/statement-001-comma-utf8-bom.csv',
			'csv/statement-002-comma-utf8-bom.csv',
			'csv/statement-003-comma-utf8-bom.csv',
			'csv/statement-004-comma-utf8-bom.csv',
			'csv/statement-005-comma-utf8-bom.csv',
			'csv/statement-006-comma-utf8-bom.csv',
			'csv/statement-007-comma-utf8-bom.csv',
			'csv/statement-015-comma-utf8-bom.csv',
			'csv/statement-016-comma-utf8-bom.csv',
			'csv/statement-017-comma-utf8-bom.csv',
			'csv/statement-022-comma-utf8-bom.csv',
			'csv/statement-024-comma-utf8-bom.csv',
			'csv/statement-025-comma-utf8-bom.csv',
			'csv/statement-026-comma-utf8-bom.csv',
			'csv/statement-027-comma-utf8-bom.csv',
			'csv/statement-028-comma-utf8-bom.csv',
			'csv/statement-029-comma-utf8-bom.csv',
			'csv/statement-030-comma-utf8-bom.csv',
			'csv/statement-031-comma-utf8-bom.csv',
			'csv/statement-032-comma-utf8-bom.csv',
			'csv/statement-039-comma-utf8-bom.csv',
			'csv/statement-040-comma-utf8-bom.csv',
			'csv/statement-041-comma-utf8-bom.csv',
			'csv/statement-046-comma-utf8-bom.csv',
			'csv/statement-048-comma-utf8-bom.csv',
			'csv/statement-049-comma-utf8-bom.csv',
			'csv/statement-050-comma-utf8-bom.csv',
			'csv/statement-051-comma-utf8-bom.csv',
			'csv/statement-052-comma-utf8-bom.csv',
			'csv/statement-053-comma-utf8-bom.csv',
			'csv/statement-054-comma-utf8-bom.csv',
			'csv/statement-055-comma-utf8-bom.csv'
		]
	},
	{
		/**
		 * Three-decimal currencies. KWD has 1000 fils to the dinar and the reader
		 * assumes two places, so no amount parses.
		 */
		why: 'Three-decimal currencies. KWD has 1000 fils to the dinar and the reader assumes two places, so no amount parses.',
		files: [
			'csv/statement-022-comma-utf8-bom.csv',
			'csv/statement-022-semicolon-win1250-crlf.csv',
			'csv/statement-046-comma-utf8-bom.csv',
			'csv/statement-046-semicolon-win1250-crlf.csv',
			'tsv/statement-022-tab-headerless.tsv',
			'tsv/statement-046-tab-headerless.tsv'
		]
	},
	{
		/**
		 * Multi-line PDF records. The geometric reader recovers two or three rows
		 * of each table and refuses the rest, which is the gap the rhythm assembler
		 * in `scratch-workspace/probe/rhythm.ts` was measured against.
		 */
		why: 'Multi-line PDF records. The geometric reader recovers two or three rows of each table and refuses the rest, which is the gap the rhythm assembler in `scratch-workspace/probe/rhythm.ts` was measured against.',
		files: [
			'pdf-text/statement-001.pdf',
			'pdf-text/statement-002.pdf',
			'pdf-text/statement-003.pdf',
			'pdf-text/statement-004.pdf',
			'pdf-text/statement-005.pdf',
			'pdf-text/statement-006.pdf',
			'pdf-text/statement-007.pdf',
			'pdf-text/statement-008.pdf',
			'pdf-text/statement-009.pdf',
			'pdf-text/statement-010.pdf',
			'pdf-text/statement-011.pdf',
			'pdf-text/statement-012.pdf',
			'pdf-text/statement-013.pdf',
			'pdf-text/statement-014.pdf',
			'pdf-text/statement-015.pdf',
			'pdf-text/statement-017.pdf',
			'pdf-text/statement-018.pdf',
			'pdf-text/statement-019.pdf',
			'pdf-text/statement-020.pdf',
			'pdf-text/statement-021.pdf',
			'pdf-text/statement-022.pdf',
			'pdf-text/statement-023.pdf',
			'pdf-text/statement-024.pdf',
			'pdf-text/statement-025.pdf',
			'pdf-text/statement-026.pdf',
			'pdf-text/statement-027.pdf',
			'pdf-text/statement-028.pdf',
			'pdf-text/statement-029.pdf',
			'pdf-text/statement-030.pdf',
			'pdf-text/statement-031.pdf',
			'pdf-text/statement-033.pdf',
			'pdf-text/statement-034.pdf',
			'pdf-text/statement-035.pdf',
			'pdf-text/statement-036.pdf',
			'pdf-text/statement-037.pdf',
			'pdf-text/statement-038.pdf',
			'pdf-text/statement-039.pdf',
			'pdf-text/statement-040.pdf',
			'pdf-text/statement-041.pdf',
			'pdf-text/statement-042.pdf',
			'pdf-text/statement-043.pdf',
			'pdf-text/statement-044.pdf',
			'pdf-text/statement-045.pdf',
			'pdf-text/statement-046.pdf',
			'pdf-text/statement-047.pdf',
			'pdf-text/statement-049.pdf',
			'pdf-text/statement-050.pdf',
			'pdf-text/statement-051.pdf',
			'pdf-text/statement-052.pdf',
			'pdf-text/statement-053.pdf',
			'pdf-text/statement-054.pdf',
			'pdf-text/statement-055.pdf',
			'pdf-text/statement-056.pdf',
			'pdf-text/statement-057.pdf',
			'pdf-text/statement-058.pdf',
			'pdf-text/statement-059.pdf',
			'pdf-text/statement-060.pdf'
		]
	},
	{
		/**
		 * A statement with no movements at all, in a format with no header and no
		 * metadata. There is nothing in the file to read, and refusing is right.
		 */
		why: 'A statement with no movements at all, in a format with no header and no metadata. There is nothing in the file to read, and refusing is right.',
		files: [
			'tsv/statement-016-tab-headerless.tsv',
			'tsv/statement-032-tab-headerless.tsv',
			'tsv/statement-048-tab-headerless.tsv'
		]
	},
	{
		/**
		 * OFX/QFX is not implemented.
		 */
		why: 'OFX/QFX is not implemented.',
		files: [
			'ofx/statement-001.ofx',
			'ofx/statement-007.ofx',
			'ofx/statement-013.ofx',
			'ofx/statement-019.ofx',
			'ofx/statement-025.ofx',
			'ofx/statement-031.ofx',
			'ofx/statement-037.ofx',
			'ofx/statement-043.ofx',
			'ofx/statement-049.ofx',
			'ofx/statement-055.ofx'
		]
	},
	{
		/**
		 * QIF is not implemented.
		 */
		why: 'QIF is not implemented.',
		files: [
			'qif/statement-001.qif',
			'qif/statement-009.qif',
			'qif/statement-017.qif',
			'qif/statement-025.qif',
			'qif/statement-033.qif',
			'qif/statement-041.qif',
			'qif/statement-049.qif',
			'qif/statement-057.qif'
		]
	},
	{
		/**
		 * OpenDocument spreadsheets are not read yet.
		 */
		why: 'OpenDocument spreadsheets are not read yet.',
		files: ['ods/multi-account-ambiguous-workbook.ods']
	},
	{
		/**
		 * A workbook holding two accounts, with no ground truth of its own: it
		 * exists to show that one sheet is silently dropped (Phase C item 8).
		 */
		why: 'A workbook holding two accounts, with no ground truth of its own: it exists to show that one sheet is silently dropped (Phase C item 8).',
		files: ['xlsx/multi-account-ambiguous-workbook.xlsx']
	}
];

const GAP_FILES = new Map(KNOWN_GAPS.flatMap((gap) => gap.files.map((file) => [file, gap.why])));

const expectationFor = (id: string) =>
	JSON.parse(readFileSync(join(ROOT, 'expected', `${id}.json`), 'utf8'));

/** The movements, as the ledger sees them: net of any separately stated fee. */
const ledgerEffect = (rows: { amountMinor: bigint; feeMinor?: bigint }[]) =>
	rows.map((row) => String(row.amountMinor - (row.feeMinor ?? 0n))).sort();

describe.skipIf(!present)('the synthetic corpus', () => {
	it('has a ground truth that agrees with itself', () => {
		// If the corpus does not add up, nothing measured against it means
		// anything. Statements with no movements print no balances, by design.
		for (const file of readdirSync(join(ROOT, 'expected'))) {
			const statement = expectationFor(file.replace('.json', ''));
			if (statement.rows.length === 0) continue;
			const sum = statement.rows.reduce(
				(total: bigint, row: { amountMinor: string; feeMinor?: string }) =>
					total + BigInt(row.amountMinor) - BigInt(row.feeMinor ?? 0),
				0n
			);
			expect(
				BigInt(statement.openingBalanceMinor) + sum,
				`${statement.id} does not reconcile`
			).toBe(BigInt(statement.closingBalanceMinor));
		}
	});

	it('lists every gap against a file that exists', () => {
		const onDisk = new Set(
			FORMATS.flatMap((format) =>
				readdirSync(join(ROOT, format)).map((file) => `${format}/${file}`)
			)
		);
		expect([...GAP_FILES.keys()].filter((file) => !onDisk.has(file))).toEqual([]);
	});

	for (const format of FORMATS) {
		it(`reads every ${format} file, or records why not`, async () => {
			const brokeUnexpectedly: string[] = [];
			const workingButListedAsAGap: string[] = [];

			for (const file of readdirSync(join(ROOT, format)).sort()) {
				const key = `${format}/${file}`;
				const id = /^(statement-\d+)/.exec(file)?.[1];
				const expected = id ? expectationFor(id) : undefined;

				let failure: string | undefined;
				try {
					const statements = await detectAndParseAll(
						new Uint8Array(readFileSync(join(ROOT, format, file))),
						expected ? { currency: expected.currency } : {}
					);
					if (!expected) failure = 'no ground truth for this file';
					else if (statements[0]?.currency !== expected.currency) {
						failure = `read as ${statements[0]?.currency}, not ${expected.currency}`;
					} else {
						const want = ledgerEffect(
							expected.rows.map((row: { amountMinor: string; feeMinor?: string }) => ({
								amountMinor: BigInt(row.amountMinor),
								feeMinor: BigInt(row.feeMinor ?? 0)
							}))
						);
						const got = ledgerEffect(statements.flatMap((statement) => statement.rows));
						if (want.join(',') !== got.join(',')) {
							failure = `${got.length} movements, not ${want.length}`;
						}
					}
				} catch (error) {
					failure = String((error as Error).message).slice(0, 80);
				}

				const gap = GAP_FILES.get(key);
				if (failure && !gap) brokeUnexpectedly.push(`${key}: ${failure}`);
				if (!failure && gap) workingButListedAsAGap.push(key);
			}

			expect(brokeUnexpectedly, 'these read correctly before').toEqual([]);
			expect(
				workingButListedAsAGap,
				'these now work — delete them from KNOWN_GAPS and say what changed'
			).toEqual([]);
		}, 300000);
	}
});
