import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectAndParse } from '$lib/server/import/detect';
import { fingerprintAll } from '$lib/server/import/fingerprint';
import { contributions, parseXtb } from '$lib/server/invest/xtb';

// Parser acceptance against the real statements in
// bank_data_examples_do_not_share/ — never committed, so this suite skips
// itself anywhere the folder is absent (CI, other machines).
const REAL_DIR = join(process.cwd(), 'bank_data_examples_do_not_share');
const present = existsSync(REAL_DIR);

const statementFiles = present ? readdirSync(REAL_DIR).filter((f) => /\.(csv|pdf)$/i.test(f)) : [];
const xtbFiles = present ? readdirSync(REAL_DIR).filter((f) => /\.xlsx$/i.test(f)) : [];

describe.skipIf(!present)('real statement files', () => {
	it('finds the expected five statement files', () => {
		expect(statementFiles.length).toBeGreaterThanOrEqual(5);
	});

	for (const file of xtbFiles) {
		describe(file, () => {
			it('parses as an XTB report with unique operation ids', () => {
				const report = parseXtb(new Uint8Array(readFileSync(join(REAL_DIR, file))));
				expect(report.summaryValueMinor).toBeGreaterThan(0n);
				expect(report.holdings.length).toBeGreaterThan(0);
				expect(report.operations.length).toBeGreaterThan(0);
				const ids = report.operations.map((o) => o.id);
				expect(new Set(ids).size).toBe(ids.length);
				expect(contributions(report.operations).length).toBeGreaterThan(0);
			}, 30000);
		});
	}

	// Formats no parser covers yet. These land across the v0.3.8 phases — the
	// two Spanish and the Komerční banka statements need the tabular/PDF work,
	// the mBank CZ and mBank PL PDFs need PDF profiles, and DE/UK/US are
	// synthetic inputs built to exercise conventions no real sample carries.
	// A file listed here must still FAIL CLEANLY: the whole point of the release
	// is that an unreadable statement says so instead of importing nothing and
	// calling it success.
	const NOT_YET_SUPPORTED = [
		/^72970193_.*\.pdf$/i, // mBank PL, PDF rendering of a CSV we do parse
		/^RK_mbank_/i, // mBank CZ
		/^RK_Bank_/i, // Komerční banka
		/^KU_3_month/i, // CaixaBank ES
		/^RK_3_month/i, // Nickel ES
		/^RHC-/i, // Robinhood EU — a holdings snapshot, not a statement at all
		/^DE_/i,
		/^UK_/i,
		/^US_/i // synthetic fixtures
	];
	const supported = statementFiles.filter((f) => !NOT_YET_SUPPORTED.some((p) => p.test(f)));
	const unsupported = statementFiles.filter((f) => NOT_YET_SUPPORTED.some((p) => p.test(f)));

	for (const file of unsupported) {
		describe(file, () => {
			it('is refused with a message a person can act on', async () => {
				const buffer = new Uint8Array(readFileSync(join(REAL_DIR, file)));
				await expect(detectAndParse(buffer)).rejects.toThrow(/\w{10,}/);
			}, 30000);
		});
	}

	for (const file of supported) {
		describe(file, () => {
			it('parses, fingerprints uniquely, and reconciles balances', async () => {
				const buffer = new Uint8Array(readFileSync(join(REAL_DIR, file)));
				const statement = await detectAndParse(buffer);

				expect(statement.rows.length).toBeGreaterThan(0);

				const prints = fingerprintAll(statement.rows);
				expect(new Set(prints).size).toBe(prints.length);

				if (
					statement.openingBalanceMinor !== undefined &&
					statement.closingBalanceMinor !== undefined
				) {
					const sum = statement.rows.reduce((s, r) => s + r.amountMinor - (r.feeMinor ?? 0n), 0n);
					expect(statement.openingBalanceMinor + sum).toBe(statement.closingBalanceMinor);
				}

				// Independent corroboration, where the bank prints it. Two omitted
				// movements that offset each other survive the check above; they
				// cannot also leave both stated totals intact.
				const credits = statement.rows
					.filter((r) => r.amountMinor > 0n)
					.reduce((s, r) => s + r.amountMinor, 0n);
				const debits = statement.rows
					.filter((r) => r.amountMinor < 0n)
					.reduce((s, r) => s - r.amountMinor, 0n);
				if (statement.statedCreditTotalMinor !== undefined) {
					expect(credits).toBe(statement.statedCreditTotalMinor);
				}
				if (statement.statedDebitTotalMinor !== undefined) {
					expect(debits).toBe(statement.statedDebitTotalMinor);
				}
				if (statement.statedRowCount !== undefined) {
					expect(statement.rows.length).toBe(statement.statedRowCount);
				}
			}, 30000);
		});
	}
});
