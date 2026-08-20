// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { ingestReport } from '$lib/server/invest/ingest';
import type { BrokerReport } from '$lib/server/invest/adapter';

let harness: Harness;
let testDb: TestDb;

/**
 * A report shaped like the one that failed in the field: a withholding-tax
 * correction naming a position, and the position itself listed after it.
 */
function report(overrides: Partial<BrokerReport> = {}): BrokerReport {
	return {
		accountCurrency: 'EUR',
		generatedAt: '2026-07-08T10:00:00.000Z',
		summaryValueMinor: 100_000n,
		holdings: [],
		operations: [
			{
				id: '1347965304',
				type: 'Withholding tax',
				ticker: 'PEP.US',
				happenedAt: '2026-07-07T20:51:48.000Z',
				amountMinor: 58n,
				comment: 'corr PEP.US USD WHT 15%',
				positionId: '1233431485'
			}
		],
		positions: [
			{
				id: '1233431485',
				ticker: 'PEP.US',
				purchaseValueMinor: 90_000n,
				saleValueMinor: 95_000n,
				openedAt: '2026-01-02T09:00:00.000Z',
				closedAt: '2026-06-30T16:00:00.000Z'
			}
		],
		...overrides
	};
}

beforeAll(async () => {
	harness = await startPostgres('broker-ingest');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate broker_operation, broker_position, holding, portfolio_snapshot, broker_import_state cascade`;
});

describe('broker ingest', () => {
	it('stores an operation whose position appears later in the report', async () => {
		await ingestReport(report(), testDb);

		const rows = await testDb
			.select()
			.from(schema.brokerOperation)
			.where(eq(schema.brokerOperation.id, '1347965304'));

		expect(rows).toHaveLength(1);
		expect(rows[0].positionId).toBe('1233431485');
	});

	it('stores an operation whose position the report never contains', async () => {
		await ingestReport(report({ positions: [] }), testDb);

		const rows = await testDb
			.select()
			.from(schema.brokerOperation)
			.where(eq(schema.brokerOperation.id, '1347965304'));

		expect(rows).toHaveLength(1);
		// The cash movement is real and is kept in full; only the link to a
		// holding interval is unknown, which is exactly what null means here.
		expect(rows[0].positionId).toBeNull();
		expect(rows[0].amountMinor).toBe(58n);
		expect(rows[0].comment).toBe('corr PEP.US USD WHT 15%');
	});

	it('backfills the link when a later report supplies the missing position', async () => {
		await ingestReport(report({ positions: [] }), testDb);
		await ingestReport({ ...report(), generatedAt: '2026-07-09T10:00:00.000Z' }, testDb);

		const rows = await testDb
			.select()
			.from(schema.brokerOperation)
			.where(eq(schema.brokerOperation.id, '1347965304'));

		expect(rows[0].positionId).toBe('1233431485');
	});
});
