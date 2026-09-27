// SPDX-License-Identifier: AGPL-3.0-or-later
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { deleteRow, insertRows, listRows, updateRow } from '$lib/server/api/tables';
import { ApiError } from '$lib/server/api/errors';
import { createToken, setTokenAccess, setTokenAreas, verifyToken } from '$lib/server/api/tokens';
import { hashToken } from '$lib/server/auth/token-hash';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeDocumentLink, makePerson, makeTransaction } from './fixtures';

/**
 * /api/v1/tables against a real schema: the database's own constraints and
 * triggers are the validation, so they are what this suite has to exercise.
 */
let harness: Harness;
let testDb: TestDb;

beforeAll(async () => {
	harness = await startPostgres('api-tables');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await testDb.execute(`truncate table trip, tag, api_token, account, document, person cascade`);
});

const query = (fields: Record<string, string>) => new URLSearchParams(fields);
const EVERYTHING = { access: 'read-write', areas: null } as const;

async function refusal(work: Promise<unknown>): Promise<ApiError> {
	const error = await work.then(
		() => null,
		(e: unknown) => e
	);
	if (!(error instanceof ApiError)) throw new Error(`expected a refusal, got ${error}`);
	return error;
}

const holiday = { name: 'Lisbon', starts_on: '2026-10-01', ends_on: '2026-10-08' };

describe('writing rows', () => {
	it('inserts with a minted key and registers the record as an entity', async () => {
		const [trip] = await insertRows(EVERYTHING, 'trip', holiday, testDb);

		expect(trip).toMatchObject({ name: 'Lisbon', starts_on: '2026-10-01', emoji: '' });
		expect(typeof trip.id).toBe('string');
		// The baseline's BEFORE INSERT trigger, not this module, does this.
		const entity = await testDb
			.select()
			.from(schema.entity)
			.where(eq(schema.entity.id, trip.id as string));
		expect(entity[0]?.kind).toBe('trip');
	});

	it('inserts an array as one statement, so a bad row takes the good ones with it', async () => {
		const refused = await refusal(
			insertRows(EVERYTHING, 'trip', [holiday, { ...holiday, starts_on: 'not a date' }], testDb)
		);
		expect(refused.status).toBe(400);
		expect((await listRows(EVERYTHING, 'trip', query({}), testDb)).total).toBe(0);
	});

	it('changes only the columns it is sent, on the row its key names', async () => {
		const [trip] = await insertRows(EVERYTHING, 'trip', holiday, testDb);
		const changed = await updateRow(
			EVERYTHING,
			'trip',
			query({ id: trip.id as string }),
			{ notes: 'Tram 28' },
			testDb
		);
		expect(changed).toMatchObject({ name: 'Lisbon', notes: 'Tram 28' });
	});

	it('addresses a composite key by every one of its columns', async () => {
		const [trip] = await insertRows(EVERYTHING, 'trip', holiday, testDb);
		const [tag] = await insertRows(
			EVERYTHING,
			'tag',
			{ name: 'Travel', normalised_name: 'travel' },
			testDb
		);
		const link = { tag_id: tag.id as string, target_id: trip.id as string };
		await insertRows(EVERYTHING, 'tag_link', link, testDb);

		expect(
			(await refusal(deleteRow(EVERYTHING, 'tag_link', query({ tag_id: link.tag_id }), testDb)))
				.status
		).toBe(400);
		expect(await deleteRow(EVERYTHING, 'tag_link', query(link), testDb)).toEqual(link);
		expect((await listRows(EVERYTHING, 'tag_link', query({}), testDb)).total).toBe(0);
	});

	it('refuses a delete that names anything but the key, so a typo cannot widen it', async () => {
		await insertRows(EVERYTHING, 'trip', holiday, testDb);
		const refused = await refusal(deleteRow(EVERYTHING, 'trip', query({ name: 'Lisbon' }), testDb));
		expect(refused.status).toBe(400);
		expect((await listRows(EVERYTHING, 'trip', query({}), testDb)).total).toBe(1);
	});

	it('answers a row that is not there with 404', async () => {
		const missing = query({ id: '0190a8d2-0000-7000-8000-000000000000' });
		expect((await refusal(deleteRow(EVERYTHING, 'trip', missing, testDb))).status).toBe(404);
		expect(
			(await refusal(updateRow(EVERYTHING, 'trip', missing, { notes: 'x' }, testDb))).status
		).toBe(404);
	});

	it('refuses to move a primary key', async () => {
		const [trip] = await insertRows(EVERYTHING, 'trip', holiday, testDb);
		const refused = await refusal(
			updateRow(
				EVERYTHING,
				'trip',
				query({ id: trip.id as string }),
				{ id: '0190a8d2-0000-7000-8000-000000000001' },
				testDb
			)
		);
		expect(refused.message).toMatch(/primary key/);
	});
});

describe("the database's refusals", () => {
	it('answers a duplicate with 409 and Postgres’ own words', async () => {
		await insertRows(EVERYTHING, 'tag', { name: 'Travel', normalised_name: 'travel' }, testDb);
		const refused = await refusal(
			insertRows(EVERYTHING, 'tag', { name: 'travel', normalised_name: 'travel' }, testDb)
		);
		expect(refused.status).toBe(409);
		expect(refused.message).toMatch(/duplicate key/);
	});

	it('answers a reference to nothing with 409', async () => {
		const [tag] = await insertRows(
			EVERYTHING,
			'tag',
			{ name: 'Travel', normalised_name: 'travel' },
			testDb
		);
		const refused = await refusal(
			insertRows(
				EVERYTHING,
				'tag_link',
				{ tag_id: tag.id, target_id: '0190a8d2-0000-7000-8000-000000000002' },
				testDb
			)
		);
		expect(refused.status).toBe(409);
	});

	it('answers a missing required column and a malformed uuid with 400', async () => {
		expect(
			(await refusal(insertRows(EVERYTHING, 'trip', { name: 'No dates' }, testDb))).status
		).toBe(400);
		expect(
			(await refusal(listRows(EVERYTHING, 'trip', query({ id: 'nope' }), testDb))).status
		).toBe(400);
	});

	it('refuses a column the table does not have, and one it may not write', async () => {
		expect(
			(await refusal(insertRows(EVERYTHING, 'trip', { ...holiday, colour: 'red' }, testDb))).status
		).toBe(400);
		const refused = await refusal(
			insertRows(EVERYTHING, 'person', { name: 'Eve', initials: 'E', role: 'admin' }, testDb)
		);
		expect(refused.message).toMatch(/read-only/);
	});

	it('does not know the tables that decide who can sign in', async () => {
		expect((await refusal(listRows(EVERYTHING, 'session', query({}), testDb))).status).toBe(404);
		expect(
			(await refusal(insertRows(EVERYTHING, 'api_token', { id: 'x', label: 'x' }, testDb))).status
		).toBe(404);
	});
});

describe('reading rows', () => {
	it('pages in key order and filters by column', async () => {
		await insertRows(
			EVERYTHING,
			'trip',
			[holiday, { ...holiday, name: 'Porto' }, { ...holiday, name: 'Faro' }],
			testDb
		);
		const first = await listRows(EVERYTHING, 'trip', query({ limit: '2' }), testDb);
		const second = await listRows(EVERYTHING, 'trip', query({ limit: '2', offset: '2' }), testDb);
		expect(first.total).toBe(3);
		expect([...first.rows, ...second.rows].map((r) => r.name).sort()).toEqual([
			'Faro',
			'Lisbon',
			'Porto'
		]);
		expect(
			(await listRows(EVERYTHING, 'trip', query({ name: 'Porto' }), testDb)).rows
		).toHaveLength(1);
	});

	it('carries money as whole minor units, as the rest of the API does', async () => {
		const txn = await makeTransaction(testDb, { amountMinor: -123456n });
		const { rows } = await listRows(EVERYTHING, 'transaction', query({ id: txn.id }), testDb);
		expect(rows[0].amount_minor).toBe(-123456);
	});
});

describe('a token’s access', () => {
	it('is read-only when issued without a choice, and switchable afterwards', async () => {
		const raw = 'api-token-for-access-test';
		const id = hashToken(raw);
		await testDb.insert(schema.apiToken).values({ id, label: 'Dashboard' });
		expect(await verifyToken(raw, testDb)).toEqual({ access: 'read', areas: null });

		await setTokenAccess(id, 'read-write', testDb);
		expect(await verifyToken(raw, testDb)).toEqual({ access: 'read-write', areas: null });

		await setTokenAccess(id, 'read', testDb);
		expect(await verifyToken(raw, testDb)).toEqual({ access: 'read', areas: null });
	});

	// Null is everything, what every token issued before areas keeps; an
	// emptied list reaches nothing rather than widening back to everything.
	it('reaches everything until limited, and exactly its areas after', async () => {
		const { raw, id } = await createToken('Travel planner', 'read-write', ['trips'], testDb);
		expect(await verifyToken(raw, testDb)).toEqual({ access: 'read-write', areas: ['trips'] });

		await setTokenAreas(id, ['trips', 'cookbook', 'trips'], testDb);
		expect((await verifyToken(raw, testDb))?.areas).toEqual(['trips', 'cookbook']);

		await setTokenAreas(id, [], testDb);
		expect((await verifyToken(raw, testDb))?.areas).toEqual([]);

		await setTokenAreas(id, null, testDb);
		expect((await verifyToken(raw, testDb))?.areas).toBeNull();
	});

	it('refuses an area the column does not know', async () => {
		await expect(
			testDb.execute(`insert into api_token (id, label, areas) values ('x', 'x', '{trips,shared}')`)
		).rejects.toThrow();
	});

	it('refuses an access the column does not know', async () => {
		await expect(
			testDb.execute(`insert into api_token (id, label, access) values ('x', 'x', 'admin')`)
		).rejects.toThrow();
	});
});

describe('payslips, for a token without Salary', () => {
	const ARCHIVE = { access: 'read-write', areas: ['documents'] } as const;
	const PAYROLL = { access: 'read', areas: ['documents', 'salary'] } as const;

	async function filed() {
		const someone = await makePerson(testDb);
		const payslip = await makeDocument(testDb, { name: 'March payslip', type: 'payslip' });
		const lease = await makeDocument(testDb, { name: 'Lease', type: 'contract' });
		for (const doc of [payslip, lease]) {
			await makeDocumentLink(testDb, { documentId: doc.id, targetId: someone.id });
			await testDb.insert(schema.documentText).values({
				documentId: doc.id,
				engine: 'test',
				engineVersion: '1',
				languages: 'eng'
			});
		}
		return { someone, payslip, lease };
	}

	it('leaves a payslip out of every table that names it, and its count', async () => {
		const { payslip, lease } = await filed();
		for (const table of ['document', 'document_text', 'document_link']) {
			const listed = await listRows(ARCHIVE, table, query({}), testDb);
			const ids = listed.rows.map((row) => row.id ?? row.document_id);
			expect(ids).toEqual([lease.id]);
			expect(listed.total).toBe(1);
			// With Salary as well, and with no limit, the payslip is there.
			expect((await listRows(PAYROLL, table, query({}), testDb)).total).toBe(2);
			expect((await listRows(EVERYTHING, table, query({}), testDb)).total).toBe(2);
		}
		expect((await listRows(ARCHIVE, 'document', query({ id: payslip.id }), testDb)).rows).toEqual(
			[]
		);
	});

	it('cannot change or delete a payslip, as if it were not there', async () => {
		const { payslip } = await filed();
		const renamed = await refusal(
			updateRow(ARCHIVE, 'document', query({ id: payslip.id }), { type: 'other' }, testDb)
		);
		expect(renamed.status).toBe(404);
		expect(
			(await refusal(deleteRow(ARCHIVE, 'document', query({ id: payslip.id }), testDb))).status
		).toBe(404);
		const [still] = await testDb
			.select({ type: schema.document.type })
			.from(schema.document)
			.where(eq(schema.document.id, payslip.id));
		expect(still.type).toBe('payslip');
	});

	it('cannot make a payslip, retype a document as one, or file one against a record', async () => {
		const { someone, payslip, lease } = await filed();
		const [shelf] = await testDb.select({ id: schema.shelf.id }).from(schema.shelf).limit(1);
		const made = await refusal(
			insertRows(
				ARCHIVE,
				'document',
				{
					name: 'Forged',
					shelf_id: shelf.id,
					type: 'payslip',
					ext: 'PDF',
					added_on: '2026-09-27'
				},
				testDb
			)
		);
		expect(made.status).toBe(403);
		expect(
			(
				await refusal(
					updateRow(ARCHIVE, 'document', query({ id: lease.id }), { type: 'payslip' }, testDb)
				)
			).status
		).toBe(403);
		const other = await makePerson(testDb, { name: 'Somebody Else' });
		expect(
			(
				await refusal(
					insertRows(
						ARCHIVE,
						'document_link',
						{ document_id: payslip.id, target_id: other.id },
						testDb
					)
				)
			).status
		).toBe(403);

		// Every refusal rolled back: nothing new, and the lease is still a contract.
		expect((await listRows(EVERYTHING, 'document', query({}), testDb)).total).toBe(2);
		expect((await listRows(EVERYTHING, 'document_link', query({}), testDb)).total).toBe(2);
		const [kept] = await testDb
			.select({ type: schema.document.type })
			.from(schema.document)
			.where(eq(schema.document.id, lease.id));
		expect(kept.type).toBe('contract');
		expect(someone.id).toBeTruthy();
	});
});
