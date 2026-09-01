// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the ribbon reads out of the database.
 *
 * The arithmetic is held by `tests/unit/statement-coverage`; this holds the
 * QUERIES, and it exists because of a failure a unit test could never have
 * caught. `${account.id}` inside a raw correlated sub-select renders as a bare
 * `"id"`, which inside `select ... from "transaction" t` binds to the
 * transaction's own id and is therefore never true — so every account came back
 * with no evidence, and the ribbon silently drew nothing at all. Nothing threw,
 * nothing logged, and every unit test still passed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoverage } from '$lib/server/statements/coverage-load';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeDocument, makeDocumentLink, makeTransaction } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let db: TestDb;
let previousUrl: string | undefined;

const TODAY = '2026-09-01';

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('statement-coverage-load', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	db = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`truncate document cascade`;
	await harness.sql`truncate account cascade`;
});

describe('loadCoverage', () => {
	it('gives an account with movements a row, even with no statement filed at all', async () => {
		// The regression. A first transaction in April is evidence the account
		// existed, so the months since are gaps that can be filed — and before
		// this, the row did not appear.
		const acc = await makeAccount(db, { name: 'Fio current' });
		await makeTransaction(db, {
			accountId: acc.id,
			bookedOn: '2026-04-01',
			amountMinor: 1000n,
			currency: 'CZK',
			dedupFingerprint: 'coverage-load-1'
		});

		const payload = await loadCoverage(2026, TODAY, db);
		expect(payload.rows).toHaveLength(1);
		expect(payload.rows[0].boxes.map((b) => b.state)).toEqual([
			'before-account',
			'before-account',
			'before-account',
			'gap',
			'gap',
			'gap',
			'gap',
			'gap',
			'not-arrived',
			'not-arrived',
			'not-arrived',
			'not-arrived'
		]);
		expect(payload.gaps).toBe(5);
	});

	it('fills the months a filed statement covers', async () => {
		const acc = await makeAccount(db, { name: 'ČSOB current' });
		await makeTransaction(db, {
			accountId: acc.id,
			bookedOn: '2026-01-05',
			amountMinor: 1000n,
			currency: 'CZK',
			dedupFingerprint: 'coverage-load-2'
		});
		const quarterly = await makeDocument(db, {
			shelfId: await shelfIdByKey('statements', db),
			type: 'bank_statement',
			periodOn: '2026-01-01',
			periodEndOn: '2026-03-31'
		});
		await makeDocumentLink(db, { documentId: quarterly.id, targetId: acc.id });

		const payload = await loadCoverage(2026, TODAY, db);
		expect(payload.rows[0].boxes[0]).toEqual({
			state: 'filed',
			startMonth: 0,
			months: 3,
			documentIds: [quarterly.id]
		});
	});

	it('leaves an account nobody has used out entirely', async () => {
		// Not missing twelve statements — never used. A row of red for an account
		// that has never seen a transaction is an accusation, not a finding.
		await makeAccount(db, { name: 'Unused savings' });
		const payload = await loadCoverage(2026, TODAY, db);
		expect(payload.rows).toEqual([]);
	});

	it('counts every document it cannot place, whatever kind it is', async () => {
		// The invariant: everything on the shelf is either drawn on the ribbon or
		// counted here. Counting only `bank_statement` left a broker report — which
		// belongs to no bank account and is deliberately not on the ribbon —
		// invisible twice over, so the shelf said "2 documents" while the ribbon
		// accounted for one.
		const statements = await shelfIdByKey('statements', db);
		await makeDocument(db, { shelfId: statements, type: 'bank_statement' });
		await makeDocument(db, { shelfId: statements, type: 'broker_report' });
		const payload = await loadCoverage(2026, TODAY, db);
		expect(payload.unplaced).toBe(2);
	});

	it('does not count a statement it has drawn', async () => {
		const acc = await makeAccount(db, { name: 'Fio current' });
		await makeTransaction(db, {
			accountId: acc.id,
			bookedOn: '2026-01-05',
			amountMinor: 1000n,
			currency: 'CZK',
			dedupFingerprint: 'coverage-load-4'
		});
		const filed = await makeDocument(db, {
			shelfId: await shelfIdByKey('statements', db),
			type: 'bank_statement',
			periodOn: '2026-01-01',
			periodEndOn: '2026-01-31'
		});
		await makeDocumentLink(db, { documentId: filed.id, targetId: acc.id });

		const payload = await loadCoverage(2026, TODAY, db);
		expect(payload.unplaced).toBe(0);
	});

	it('refuses to walk past the current year, or before the first account', async () => {
		const acc = await makeAccount(db, { name: 'Fio current' });
		await makeTransaction(db, {
			accountId: acc.id,
			bookedOn: '2025-06-01',
			amountMinor: 1000n,
			currency: 'CZK',
			dedupFingerprint: 'coverage-load-3'
		});

		const bounds = await loadCoverage(2026, TODAY, db);
		expect([bounds.firstYear, bounds.lastYear]).toEqual([2025, 2026]);
		// A year typed into the address bar lands on the nearest real one.
		expect((await loadCoverage(2099, TODAY, db)).year).toBe(2026);
		expect((await loadCoverage(1999, TODAY, db)).year).toBe(2025);
	});
});
