// SPDX-License-Identifier: AGPL-3.0-or-later
// A loan is a thing a bank numbers and sends statements about, so it gets the
// same ribbon an account gets. Its first evidence is its own start rather than a
// first movement: a mortgage has no transactions of its own here, and without
// that bound its opening year would draw as twelve missing months.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCoverage } from '$lib/server/statements/coverage-load';
import { rowId } from '../row-id';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeDocument, makeDocumentLink, makeLoan, makeTransaction } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

const TODAY = '2026-09-19';
const LOAN = rowId('coverage-loan-cs');

beforeAll(async () => {
	harness = await startPostgres('coverage-loans');
	testDb = harness.db;
	previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`truncate table entity, document, loan, account, transaction restart identity cascade`;
	await makeLoan(testDb, { id: LOAN, name: 'ČS hypotéka', startsOn: '2025-01-01' });
	const march = await makeDocument(testDb, {
		name: 'ČS hypotéka 2025-03',
		shelfKey: 'statements',
		type: 'bank_statement',
		periodOn: '2025-03-01',
		periodEndOn: '2025-03-31'
	});
	await makeDocumentLink(testDb, { documentId: march.id, targetId: LOAN });
});

describe('loadCoverage with loans', () => {
	it('draws a row for a loan, not only for an account', async () => {
		const payload = await loadCoverage(2025, TODAY, testDb);
		const row = payload.rows.find((r) => r.label === 'ČS hypotéka');
		expect(row).toBeDefined();
		expect(row?.boxes.filter((b) => b.state === 'filed')).toHaveLength(1);
	});

	it('calls the months after it started, and before today, missing', async () => {
		const payload = await loadCoverage(2025, TODAY, testDb);
		const row = payload.rows.find((r) => r.label === 'ČS hypotéka');
		// Eleven of twelve: every month of 2025 except the March that is filed.
		expect(row?.boxes.filter((b) => b.state === 'gap')).toHaveLength(11);
	});

	it("does not call a loan's months missing before it started", async () => {
		// An older account, so 2024 is a year the ribbon can be navigated to at
		// all — on the loan alone the year clamps forward to 2025, since there is
		// no evidence anything existed before it.
		const older = await makeAccount(testDb, { name: 'ČS běžný účet' });
		await makeTransaction(testDb, { accountId: older.id, bookedOn: '2023-05-04' });

		const payload = await loadCoverage(2024, TODAY, testDb);
		const row = payload.rows.find((r) => r.label === 'ČS hypotéka');
		// A mortgage taken out in 2025 is not missing twelve 2024 statements: it
		// did not exist, which is a different fact from nobody having filed.
		expect(row?.boxes.every((b) => b.state === 'before-account')).toBe(true);
	});

	// Everything on the shelf is either drawn here or counted as unplaced. A
	// mortgage statement is drawn now, so counting it too would have the banner
	// disagreeing with the ribbon beneath it.
	it('does not also count a drawn mortgage statement as unplaced', async () => {
		const payload = await loadCoverage(2025, TODAY, testDb);
		expect(payload.unplaced).toBe(0);
	});
});
