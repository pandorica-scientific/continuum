import { describe, expect, it } from 'vitest';
import { decideImport, proveStatement } from '$lib/server/import/proof';
import type { ParsedRow, ParsedStatement } from '$lib/server/import/types';

const row = (
	bookedAt: string,
	amountMinor: bigint,
	balanceAfterMinor?: bigint,
	extra: Partial<ParsedRow> = {}
): ParsedRow => ({ bookedAt, amountMinor, currency: 'CZK', balanceAfterMinor, ...extra });

/** Opening 1000,00 → three movements → closing 1150,00, chain intact. */
const chained = (over: Partial<ParsedStatement> = {}): ParsedStatement => ({
	bank: 'test',
	format: 'csv',
	currency: 'CZK',
	openingBalanceMinor: 100000n,
	closingBalanceMinor: 115000n,
	rows: [
		row('2025-03-01', -5000n, 95000n),
		row('2025-03-02', 30000n, 125000n),
		row('2025-03-03', -10000n, 115000n)
	],
	...over
});

const status = (checks: { name: string; status: string }[], name: string) =>
	checks.find((c) => c.name === name)?.status;

describe('proof classes', () => {
	it('P4 — a closing chain corroborated by stated totals', () => {
		const proof = proveStatement(
			chained({ statedCreditTotalMinor: 30000n, statedDebitTotalMinor: 15000n })
		);
		expect(proof.proofClass).toBe('P4');
		expect(status(proof.checks, 'running balance')).toBe('pass');
		expect(status(proof.checks, 'stated totals')).toBe('pass');
	});

	it('P3 — a complete chain with nothing independent to check it against', () => {
		const proof = proveStatement(chained());
		expect(proof.proofClass).toBe('P3');
		expect(status(proof.checks, 'stated totals')).toBe('unavailable');
	});

	it('P2 — no running balance, but the endpoints AND the stated totals agree', () => {
		const proof = proveStatement({
			...chained(),
			rows: chained().rows.map((r) => ({ ...r, balanceAfterMinor: undefined })),
			statedCreditTotalMinor: 30000n,
			statedDebitTotalMinor: 15000n
		});
		expect(proof.proofClass).toBe('P2');
	});

	it('P1 — the endpoints agree with nothing to corroborate them', () => {
		const proof = proveStatement({
			...chained(),
			rows: chained().rows.map((r) => ({ ...r, balanceAfterMinor: undefined }))
		});
		expect(proof.proofClass).toBe('P1');
	});

	it('P0 — a statement that proves nothing at all', () => {
		const proof = proveStatement({
			bank: 'test',
			format: 'csv',
			currency: 'CZK',
			rows: [row('2025-03-01', -5000n)]
		});
		expect(proof.proofClass).toBe('P0');
	});

	it('refuses outright when stated totals CONTRADICT the rows', () => {
		// Two movements dropped so the endpoints still close — but the stated
		// totals no longer match. Evidence that disagrees is not weaker evidence;
		// it is proof that something is wrong, so this is P0, not a lesser pass.
		const base = chained();
		const mutilated: ParsedStatement = {
			...base,
			rows: [row('2025-03-01', -5000n), row('2025-03-02', 20000n)],
			openingBalanceMinor: 100000n,
			closingBalanceMinor: 115000n,
			statedCreditTotalMinor: 30000n,
			statedDebitTotalMinor: 15000n
		};
		const proof = proveStatement(mutilated);
		expect(status(proof.checks, 'opening and closing')).toBe('pass');
		expect(status(proof.checks, 'stated totals')).toBe('fail');
		expect(proof.proofClass).toBe('P0');
	});

	it('refuses a closing chain whose printed closing balance disagrees', () => {
		// A chain closes over the rows it HAS, so a movement missing from the end
		// leaves every remaining step following perfectly. Only the printed
		// closing balance notices — a real German statement read 9 of its 10
		// movements exactly this way and was rated strong enough to file.
		const truncated = chained();
		truncated.rows = truncated.rows.slice(0, 2);
		const proof = proveStatement(truncated);
		expect(status(proof.checks, 'running balance')).toBe('pass');
		expect(status(proof.checks, 'opening and closing')).toBe('fail');
		expect(proof.proofClass).toBe('P0');
	});
});

describe('the chain', () => {
	it('reads a statement listed newest first', () => {
		const reversed = chained();
		const proof = proveStatement({ ...reversed, rows: [...reversed.rows].reverse() });
		expect(proof.proofClass).toBe('P3');
		expect(proof.chainModel).toBe('newest first');
	});

	it('nets a separate fee out of the movement, as Revolut prints it', () => {
		const withFee: ParsedStatement = {
			bank: 'test',
			format: 'csv',
			currency: 'CZK',
			rows: [
				row('2025-03-01', -5000n, 95000n, { feeMinor: 0n }),
				// 30 000 credited less a 100 fee = 29 900.
				row('2025-03-02', 30000n, 124900n, { feeMinor: 100n })
			],
			openingBalanceMinor: 100000n,
			closingBalanceMinor: 124900n
		};
		expect(proveStatement(withFee).proofClass).toBe('P3');
	});

	it('refuses a chain that closes internally but not against the opening balance', () => {
		// Every step follows, yet the first row does not follow from the opening
		// balance: the movements are internally consistent and still wrong.
		const adrift = chained({ openingBalanceMinor: 999999n, closingBalanceMinor: 115000n });
		const proof = proveStatement(adrift);
		expect(status(proof.checks, 'running balance')).toBe('fail');
		expect(proof.proofClass).toBe('P0');
	});

	it('does not treat a partial balance column as a chain', () => {
		const partial = chained();
		partial.rows[1].balanceAfterMinor = undefined;
		const proof = proveStatement(partial);
		expect(status(proof.checks, 'running balance')).toBe('fail');
	});
});

describe('lexical soundness', () => {
	const facts = (over: Record<string, unknown> = {}) => ({
		currency: 'CZK',
		amountTexts: ['-50,00', '300,00', '-100,00'],
		decimalMarkSettled: true,
		dateOrderSettled: true,
		...over
	});

	it('passes when the amounts are written the way they were read', () => {
		const proof = proveStatement(chained(), facts());
		expect(proof.lexicallyUnsound).toBe(false);
		expect(proof.proofClass).toBe('P3');
	});

	it('catches the uniform scale error that arithmetic alone cannot', () => {
		// Every amount and balance misread by a factor of a thousand still closes
		// the chain perfectly. It shows up as impossible precision for the
		// currency, which is the only place it CAN show up.
		const proof = proveStatement(chained(), facts({ amountTexts: ['-50,00000', '300,00000'] }));
		expect(proof.lexicallyUnsound).toBe(true);
		expect(proof.proofClass).toBe('P0');
		expect(decideImport(proof, 0).autoImport).toBe(false);
	});

	it('does not mistake a thousands group for excess precision', () => {
		const proof = proveStatement(chained(), facts({ amountTexts: ['1.234', '5.678'] }));
		expect(proof.lexicallyUnsound).toBe(false);
	});

	it('honours a zero-decimal currency', () => {
		// HUF has no minor unit, so "12500,50" is not a forint amount.
		const proof = proveStatement(chained(), facts({ currency: 'HUF', amountTexts: ['12500,50'] }));
		expect(proof.lexicallyUnsound).toBe(true);
	});

	it('rejects a column that mixes negative markers', () => {
		const proof = proveStatement(chained(), facts({ amountTexts: ['-50,00', '(300,00)'] }));
		expect(proof.lexicallyUnsound).toBe(true);
	});

	it('fails when the reader had to pick a convention without evidence', () => {
		expect(proveStatement(chained(), facts({ decimalMarkSettled: false })).lexicallyUnsound).toBe(
			true
		);
		expect(proveStatement(chained(), facts({ dateOrderSettled: false })).lexicallyUnsound).toBe(
			true
		);
	});
});

describe('the import policy', () => {
	it('files a chained statement without asking', () => {
		expect(decideImport(proveStatement(chained()), 0).autoImport).toBe(true);
	});

	it('files weaker arithmetic when the layout left nothing open', () => {
		const aggregate = proveStatement({
			...chained(),
			rows: chained().rows.map((r) => ({ ...r, balanceAfterMinor: undefined }))
		});
		expect(aggregate.proofClass).toBe('P1');
		expect(decideImport(aggregate, 0).autoImport).toBe(true);
	});

	it('asks when a single dimension is still open, however strong the arithmetic', () => {
		const decision = decideImport(proveStatement(chained()), 1);
		expect(decision.autoImport).toBe(false);
		expect(decision.reason).toMatch(/undecided/);
	});

	it('never files a statement that proves nothing', () => {
		const nothing = proveStatement({
			bank: 'test',
			format: 'csv',
			currency: 'CZK',
			rows: [row('2025-03-01', -5000n)]
		});
		expect(decideImport(nothing, 0).autoImport).toBe(false);
	});
});
