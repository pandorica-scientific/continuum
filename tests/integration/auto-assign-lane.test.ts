// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeDocumentLink, makeLane, makeOrganisation } from './fixtures';
import { autoAssignLane } from '$lib/server/documents/mutations';

let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('auto-assign-lane');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate person, organisation, document cascade`;
});

describe('autoAssignLane', () => {
	it('slots a document into the one lane that matches it', async () => {
		const org = await makeOrganisation(testDb);
		const payslips = await makeLane(testDb, {
			entityId: org.id,
			label: 'Payslips',
			cadence: 'monthly',
			conditions: [{ field: 'type', op: 'is', value: 'payslip' }]
		});
		const doc = await makeDocument(testDb, { type: 'payslip', shelfKey: 'income_tax' });
		await makeDocumentLink(testDb, { documentId: doc.id, targetId: org.id });

		await autoAssignLane(org.id, doc.id, testDb);

		const [row] = await testDb.select().from(schema.document).where(eq(schema.document.id, doc.id));
		expect(row?.laneId).toBe(payslips.id);
	});

	it('leaves the document in History when nothing matches', async () => {
		const org = await makeOrganisation(testDb);
		await makeLane(testDb, {
			entityId: org.id,
			label: 'Payslips',
			cadence: 'monthly',
			conditions: [{ field: 'type', op: 'is', value: 'payslip' }]
		});
		const doc = await makeDocument(testDb, { type: 'contract', shelfKey: 'income_tax' });
		await makeDocumentLink(testDb, { documentId: doc.id, targetId: org.id });

		await autoAssignLane(org.id, doc.id, testDb);

		const [row] = await testDb.select().from(schema.document).where(eq(schema.document.id, doc.id));
		expect(row?.laneId).toBeNull();
	});

	it('leaves the document in History when two lanes on the same card both match', async () => {
		const org = await makeOrganisation(testDb);
		await makeLane(testDb, {
			entityId: org.id,
			label: 'Payslips',
			cadence: 'monthly',
			conditions: [{ field: 'type', op: 'is', value: 'payslip' }]
		});
		await makeLane(testDb, {
			entityId: org.id,
			label: 'Also payslips',
			cadence: 'monthly',
			conditions: [{ field: 'type', op: 'is', value: 'payslip' }]
		});
		const doc = await makeDocument(testDb, { type: 'payslip', shelfKey: 'income_tax' });
		await makeDocumentLink(testDb, { documentId: doc.id, targetId: org.id });

		await autoAssignLane(org.id, doc.id, testDb);

		const [row] = await testDb.select().from(schema.document).where(eq(schema.document.id, doc.id));
		expect(row?.laneId).toBeNull();
	});

	it('never lets a catch-all (no-conditions) lane claim a document on its own', async () => {
		const org = await makeOrganisation(testDb);
		const catchAll = await makeLane(testDb, {
			entityId: org.id,
			label: 'Changes to pay',
			cadence: 'none',
			conditions: []
		});
		const doc = await makeDocument(testDb, { type: 'payslip', shelfKey: 'income_tax' });
		await makeDocumentLink(testDb, { documentId: doc.id, targetId: org.id });

		await autoAssignLane(org.id, doc.id, testDb);

		const [row] = await testDb.select().from(schema.document).where(eq(schema.document.id, doc.id));
		expect(row?.laneId).toBeNull();
		expect(row?.laneId).not.toBe(catchAll.id);
	});
});
