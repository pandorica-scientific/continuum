// SPDX-License-Identifier: AGPL-3.0-or-later
// Which band a document draws in is read off the period it declares, and which
// bands an account gets a row on is read off what it holds. Neither is read
// off `document.type` or `account.kind` any more — see `bandFor` and
// `bandsForAccount`.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeAccount, makeDocument, makeDocumentLink, makeLoan, makeTransaction } from './fixtures';
import { loadCoverage } from '$lib/server/statements/coverage-load';

let harness: Harness;
let testDb: TestDb;

const TODAY = '2025-08-31';

beforeAll(async () => {
	harness = await startPostgres('statement-coverage-bands');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	// entity too: TRUNCATE fires no row triggers, so a document's registration
	// would outlive the row it belongs to and collide on a reused id.
	await harness.sql`truncate entity, account, loan, document, transaction, tag, tag_link cascade`;
});

/** A broker report on the statements shelf, filed against `accountId`. */
async function fileReport(
	accountId: string,
	periodOn: string,
	periodEndOn: string | null
): Promise<string> {
	const doc = await makeDocument(testDb, {
		name: `report ${periodOn}`,
		shelfKey: 'statements',
		type: 'broker_report',
		periodOn,
		periodEndOn
	});
	await makeDocumentLink(testDb, { documentId: doc.id, targetId: accountId });
	return doc.id;
}

describe('bands on the Statements shelf', () => {
	// The case the old code could not draw at all: the document landed in the
	// monthly query and its account was excluded from the monthly band.
	it('draws a quarterly broker report across its three months', async () => {
		const account = await makeAccount(testDb, { name: 'XTB portfolio', kind: 'brokerage' });
		await fileReport(account.id, '2025-01-01', '2025-03-31');

		const payload = await loadCoverage(2025, TODAY, testDb);

		const row = payload.rows.find((r) => r.accountId === account.id);
		expect(row).toBeDefined();
		const filed = row!.boxes.filter((b) => b.state === 'filed');
		expect(filed).toHaveLength(1);
		expect(filed[0]).toMatchObject({ startMonth: 0, months: 3 });
	});

	it('draws an annual broker report on the yearly band and not the monthly one', async () => {
		const account = await makeAccount(testDb, { name: 'XTB portfolio', kind: 'brokerage' });
		await fileReport(account.id, '2025-01-01', '2025-12-31');

		const payload = await loadCoverage(2025, TODAY, testDb);

		expect(payload.rows.find((r) => r.accountId === account.id)).toBeUndefined();
		expect(payload.yearly?.rows.map((r) => r.accountId)).toContain(account.id);
	});

	// Regression guard. A mortgage has no transactions of its own and its
	// missing statements are the whole reason this shelf exists.
	it('keeps a loan with nothing filed on the monthly band', async () => {
		const mortgage = await makeLoan(testDb, { name: 'Flat', startsOn: '2025-01-01' });

		const payload = await loadCoverage(2025, TODAY, testDb);

		const row = payload.rows.find((r) => r.accountId === mortgage.id);
		expect(row).toBeDefined();
		expect(row!.boxes.some((b) => b.state === 'gap')).toBe(true);
	});

	it('keeps a current account with movements on the monthly band', async () => {
		const account = await makeAccount(testDb, { name: 'Current', kind: 'current' });
		await makeTransaction(testDb, { accountId: account.id, bookedOn: '2025-02-10' });

		const payload = await loadCoverage(2025, TODAY, testDb);

		expect(payload.rows.map((r) => r.accountId)).toContain(account.id);
	});

	// The invariant the shelf keeps: everything on it is drawn or counted.
	// A linked report is drawn, so it must not also be counted as unplaced.
	it('stops counting a linked broker report as unplaced', async () => {
		const account = await makeAccount(testDb, { name: 'XTB portfolio', kind: 'brokerage' });
		await fileReport(account.id, '2025-01-01', '2025-12-31');

		const payload = await loadCoverage(2025, TODAY, testDb);

		expect(payload.unplaced).toBe(0);
	});
});
