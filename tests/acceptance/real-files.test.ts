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

	for (const file of statementFiles) {
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
			}, 30000);
		});
	}
});
