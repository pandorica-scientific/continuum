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
		why: 'QIF records a date, an amount, a payee and a memo and nothing else \u2014 no balances, no totals, no count. There is nothing in the file for the arithmetic to check, so it is refused rather than taken on trust. A property of the format, not a gap in the reader.',
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
		why: 'A statement with no movements at all, in a format that carries no balances either \u2014 a headerless ledger, or a comma-on-comma CSV whose header cannot be split. There is nothing in the file to read and nothing to check it against, so refusing is right.',
		files: [
			'csv/statement-016-comma-utf8-bom.csv',
			'csv/statement-032-comma-utf8-bom.csv',
			'csv/statement-048-comma-utf8-bom.csv',
			'tsv/statement-016-tab-headerless.tsv',
			'tsv/statement-032-tab-headerless.tsv',
			'tsv/statement-048-tab-headerless.tsv'
		]
	},
	{
		why: 'A dot-decimal PDF whose every figure has three digits after the separator, in a two-decimal currency: the separator could be a decimal point or a thousands group, and nothing in the file settles it.',
		files: ['pdf-text/statement-018.pdf', 'pdf-text/statement-042.pdf']
	},
	{
		why: "Three-decimal currency in a PDF: the amounts parse, but three of eight rows carry a figure the reader cannot resolve to KWD's 1000 fils.",
		files: ['pdf-text/statement-022.pdf', 'pdf-text/statement-046.pdf']
	},
	{
		why: 'OpenDocument spreadsheets are not read yet.',
		files: ['ods/multi-account-ambiguous-workbook.ods']
	},
	{
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
