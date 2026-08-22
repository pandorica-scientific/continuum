// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRevolut } from '$lib/server/import/adapters/revolut';
import { proveStatement } from '$lib/server/import/proof';

// Revolut exports every POCKET into one file, keyed by the Product column. The
// reporter's real export held 1798 Current rows and three Savings rows — the
// Savings pocket carrying its own balance chain (0.17 -> 0.00) and its own
// dates, two years before the rest. Read as one statement it proved P0, "the
// running balance does not follow from the movements", because the chain of one
// account was being checked against the balances of two. Removing only those
// three rows took the same file to P3, chain closes on all 1798.
//
// This fixture is that shape, reduced: two pockets, a fee-bearing row, and a
// REVERTED row which carries no balance at all.
const text = readFileSync('tests/fixtures/revolut-pockets.csv', 'utf8');

describe('a Revolut export with more than one pocket', () => {
	it('is read as one statement per pocket', () => {
		const statements = parseRevolut(text);
		expect(Array.isArray(statements)).toBe(true);
		expect(statements).toHaveLength(2);
	});

	it('gives each pocket a chain that closes on its own rows', () => {
		const statements = parseRevolut(text);
		for (const statement of statements) {
			const proof = proveStatement(statement, { currency: statement.currency });
			const chain = proof.checks.find((check) => check.name === 'running balance');
			expect(chain?.status, `${statement.rows.length} rows: ${chain?.detail}`).toBe('pass');
		}
	});

	it('gives each pocket its own period and closing balance', () => {
		const [current, savings] = parseRevolut(text).sort((a, b) => b.rows.length - a.rows.length);

		// The Current pocket: four completed rows, July 2026, closing at 3600.00.
		expect(current.rows).toHaveLength(4);
		expect(current.periodStart).toBe('2026-07-01');
		expect(current.periodEnd).toBe('2026-07-20');
		expect(current.closingBalanceMinor).toBe(360000n);

		// The Savings pocket kept its own dates rather than borrowing the file's.
		// Reading them as one statement is what made the period read June 2024 and
		// the closing balance read zero.
		expect(savings.periodEnd).toBe('2024-06-20');
		expect(savings.closingBalanceMinor).toBe(0n);
	});

	it('keeps the fee out of the amount and still lets the chain close', () => {
		const [current] = parseRevolut(text).sort((a, b) => b.rows.length - a.rows.length);
		const transfer = current.rows.find((row) => row.counterparty === 'To A Person');
		expect(transfer?.amountMinor).toBe(-100000n);
		expect(transfer?.feeMinor).toBe(700n);
	});

	it('skips the reverted row, which never moved any money', () => {
		const statements = parseRevolut(text);
		const all = statements.flatMap((statement) => statement.rows);
		expect(all.some((row) => row.counterparty === 'A shop')).toBe(false);
	});
});

describe('a Revolut export with one pocket', () => {
	it('still reads as a single statement', () => {
		const single = parseRevolut(readFileSync('tests/fixtures/revolut.csv', 'utf8'));
		expect(single).toHaveLength(1);
	});
});
