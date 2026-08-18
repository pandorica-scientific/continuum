import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectAndParseAll } from '$lib/server/import/detect';
import { fingerprintAll } from '$lib/server/import/fingerprint';
import { proveStatement, type ProofClass } from '$lib/server/import/proof';

/**
 * What every sample statement must do — named, one by one.
 *
 * This exists because a total pass-count is not a safety net. Four changes in a
 * row each fixed one statement and broke another; the count stayed the same and
 * the swap went unnoticed, twice. An aggregate cannot tell you that Raiffeisenbank
 * started working as Fio stopped.
 *
 * So each file states what it should do and why. A change that trades one
 * statement for another now fails with both names on the screen.
 *
 * The samples are private and never committed, so this suite skips itself
 * anywhere the folder is absent.
 */
const REAL_DIR = resolve('bank_data_examples_do_not_share');
const present = existsSync(REAL_DIR);

interface Expectation {
	file: string;
	/** Why this file is in the corpus at all. */
	note: string;
	outcome: 'imports' | 'refuses';
	bank?: string;
	/**
	 * The denomination, asserted for every importing file.
	 *
	 * This suite was green while a 140-row euro statement imported as Czech
	 * koruna, because it checked how MANY rows arrived and never what they were
	 * worth. A row count cannot see a wrong currency, and a wrong currency is a
	 * wrong number in someone's ledger.
	 */
	currency?: string;
	rows?: number;
	proof?: ProofClass;
	/** Opening + movements = closing must hold exactly. */
	reconciles?: boolean;
	/** Part of the refusal message, so the reason is pinned and not just the fact. */
	because?: RegExp;
}

const CORPUS: Expectation[] = [
	// ---- banks with a hand-written adapter ----
	{
		file: '72970193_260701_260731.csv',
		note: 'mBank PL — the only sample printing a per-direction row count, so the only P4 CSV',
		outcome: 'imports',
		bank: 'mbank',
		currency: 'PLN',
		rows: 5,
		proof: 'P4',
		reconciles: true
	},
	{
		file: 'Account_statement_0-6125071053_from_20260630.pdf',
		note: 'Česká spořitelna — 2-5 physical lines per movement, hence a hand-written parser',
		outcome: 'imports',
		bank: 'cs',
		currency: 'CZK',
		rows: 104,
		proof: 'P2',
		reconciles: true
	},
	{
		file: 'KS_Bank_01:2025.pdf',
		note: 'Raiffeisenbank JANUARY template — unspaced dates; read zero rows before v0.3.8',
		outcome: 'imports',
		bank: 'rb',
		currency: 'CZK',
		rows: 43,
		proof: 'P2',
		reconciles: true
	},
	{
		file: 'KS_Bank_03:2025.pdf',
		note: 'Raiffeisenbank MARCH template — the same bank, three months later, different layout',
		outcome: 'imports',
		bank: 'rb',
		currency: 'CZK',
		rows: 30,
		proof: 'P2',
		reconciles: true
	},
	{
		file: 'Statement_0093531803_CZK_2026_007.pdf',
		note: 'Raiffeisenbank 2026 — the template the parser was originally written against',
		outcome: 'imports',
		bank: 'rb',
		currency: 'CZK',
		rows: 44,
		proof: 'P2',
		reconciles: true
	},
	{
		file: 'Vypis_z_uctu-2101106516_20260701-20260731_cislo-7.csv',
		note: 'Fio — a two-row month, the smallest statement in the corpus',
		outcome: 'imports',
		bank: 'fio',
		currency: 'CZK',
		rows: 2,
		proof: 'P2',
		reconciles: true
	},
	{
		file: 'Vypis_z_uctu-2500834780_20260701-20260731_cislo-7.csv',
		note: 'Fio — ungrouped integer amounts, which a grouped-only number pattern silently dropped',
		outcome: 'imports',
		bank: 'fio',
		currency: 'CZK',
		rows: 6,
		proof: 'P2',
		reconciles: true
	},
	{
		file: 'account-statement_2026-07-01_2026-07-31_en_38c41c.csv',
		note: 'Revolut — amount net of a separate fee, and no opening balance printed',
		outcome: 'imports',
		bank: 'revolut',
		currency: 'CZK',
		rows: 38,
		proof: 'P3'
	},

	// ---- banks with NO adapter, read by geometry and arithmetic alone ----
	{
		file: 'UK_Statement_04_2025.pdf',
		note: 'Paid out / Paid in columns: direction comes only from which column holds the value',
		outcome: 'imports',
		bank: 'tabular',
		currency: 'GBP',
		rows: 10,
		proof: 'P4',
		reconciles: true
	},
	{
		file: 'DE_Kontoauszug_03_2025.pdf',
		note: 'Soll/Haben suffix: the amount is unsigned, so the sign is derived from the balance',
		outcome: 'imports',
		bank: 'tabular',
		currency: 'EUR',
		rows: 10,
		proof: 'P4',
		reconciles: true
	},

	{
		file: '72970193_260701_260731.pdf',
		note: 'mBank PL as a PDF — read by rhythm assembly, and it must agree with the CSV the adapter reads: same five amounts, same balances, same proof class, no bank-specific code',
		outcome: 'imports',
		bank: 'tabular',
		currency: 'PLN',
		rows: 5,
		proof: 'P4',
		reconciles: true
	},

	{
		file: 'KU_3_month_bank_statment.pdf',
		note: 'CaixaBank — three months across EIGHT pages, joined into one table; a currency symbol travels with each amount',
		outcome: 'imports',
		bank: 'tabular',
		currency: 'EUR',
		rows: 140,
		proof: 'P3'
	},

	// ---- documents that must be REFUSED, and for the stated reason ----
	{
		file: 'RHC-Account statement-2026-06-30.pdf',
		note: 'Robinhood — balances but no movements; a holdings snapshot, not a statement',
		outcome: 'refuses',
		because: /portfolio statement/i
	},
	{
		file: 'US_Statement_03_2025.pdf',
		note: 'Every day and month is 12 or lower by construction — the date order is undecidable',
		outcome: 'refuses',
		because: /12 or lower|undecided|confidently/i
	},
	{
		file: 'EUR_2034824_2006-01-01_2026-08-12.xlsx',
		note: 'XTB broker report — read as a table, correctly unprovable as a bank statement',
		outcome: 'refuses',
		because: /confidently|broker/i
	},

	// ---- known gap: multi-line records, three files ----
	//
	// Each prints a movement across several physical lines. `frompdf.ts` reads a
	// table by deciding which line starts a movement, and these give no usable
	// answer: their continuation lines carry dates and figures too.
	//
	// This was recorded as ONE limitation over FOUR files, and as a structural
	// boundary rather than a defect. That was wrong. `rhythm.ts` assembles all
	// four correctly — mBank PL now imports above, matching its own CSV exactly —
	// and the three below assemble correctly as well. They stop later, at the
	// proof gate, each for its own reason:
	//
	//   Komerční banka   the decimal convention cannot be settled from the table
	//   mBank CZ         two columns both read as amounts, mixing conventions
	//   Nickel ES        assembles 11 movements with no arithmetic to check them
	//
	// So this is no longer one gap but three, and none of them is the assembler.
	{
		file: 'RK_3_month_bank_statment.pdf',
		note: 'GAP: Nickel ES',
		outcome: 'refuses',
		because: /No table|confidently/i
	},
	{
		file: 'RK_Bank_01:2025.pdf',
		note: 'GAP: Komerční banka — multi-line movements',
		outcome: 'refuses',
		because: /No table|confidently/i
	},
	{
		file: 'RK_mbank_08_24 2.pdf',
		note: 'GAP: mBank CZ',
		outcome: 'refuses',
		because: /No table|confidently/i
	}
];

describe.skipIf(!present)('the sample corpus, file by file', () => {
	it('covers every sample present on disk', () => {
		// A statement in the folder but not in this list is an unmeasured
		// statement: it can start or stop working and nothing would say so.
		const listed = new Set(CORPUS.map((c) => c.file));
		const onDisk = readdirSync(REAL_DIR).filter((f) => /\.(csv|pdf|xlsx)$/i.test(f));
		expect(onDisk.filter((f) => !listed.has(f))).toEqual([]);
	});

	for (const expectation of CORPUS) {
		describe(`${expectation.file} — ${expectation.note}`, () => {
			const read = async () =>
				detectAndParseAll(new Uint8Array(readFileSync(join(REAL_DIR, expectation.file))));

			if (expectation.outcome === 'refuses') {
				it('is refused, for the reason recorded here', async () => {
					await expect(read()).rejects.toThrow(expectation.because ?? /./);
				}, 60000);
				return;
			}

			it('imports exactly what it should', async () => {
				const [statement] = await read();
				expect(statement.bank).toBe(expectation.bank);
				expect(statement.currency).toBe(expectation.currency);
				expect(statement.rows).toHaveLength(expectation.rows!);
				// Every row carries the statement's own denomination. A row labelled
				// with a foreign currency means the FX original leaked into the
				// ledger field, which is a hundredfold error waiting on a
				// zero-decimal currency.
				for (const row of statement.rows) expect(row.currency).toBe(expectation.currency);

				const proof = proveStatement(statement, { currency: statement.currency });
				expect(proof.proofClass).toBe(expectation.proof);

				// Two movements that fingerprint alike would be deduplicated against
				// each other, and the second would vanish on import.
				const prints = fingerprintAll(statement.rows);
				expect(new Set(prints).size).toBe(prints.length);

				if (expectation.reconciles) {
					const sum = statement.rows.reduce(
						(total, row) => total + row.amountMinor - (row.feeMinor ?? 0n),
						0n
					);
					expect(statement.openingBalanceMinor! + sum).toBe(statement.closingBalanceMinor);
				}
			}, 60000);
		});
	}
});
