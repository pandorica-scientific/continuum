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

	// Postgres' detail for a NOT NULL or CHECK refusal is "Failing row contains
	// (…)": the whole row, hidden columns included.
	it('never answers with the failing row, which holds the hidden columns', async () => {
		const someone = await makePerson(testDb, { passwordHash: 'hash-that-must-not-leak' });
		const refused = await refusal(
			updateRow(EVERYTHING, 'person', query({ id: someone.id }), { name: null }, testDb)
		);
		expect(refused.status).toBe(400);
		expect(refused.message).toMatch(/not-null/);
		expect(refused.message).not.toMatch(/Failing row|hash-that-must-not-leak/);
	});

	// ON DELETE RESTRICT and NO ACTION hold a delete back for the same reason.
	it('answers a delete a RESTRICT key holds back with 409, as any other held delete', async () => {
		const [shelf] = await insertRows(
			EVERYTHING,
			'shelf',
			{ key: 'cars', label: 'Cars', template: 'dossier', unit: 'subject', question: 'Which car?' },
			testDb
		);
		await makeDocument(testDb, { shelfId: shelf.id as string });
		const refused = await refusal(
			deleteRow(EVERYTHING, 'shelf', query({ id: shelf.id as string }), testDb)
		);
		expect(refused.status).toBe(409);
		await testDb.execute(`delete from document; delete from shelf where key = 'cars'`);
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

	// Postgres keeps microseconds and an answer carries milliseconds; a value
	// the API handed out has to find its own row again.
	it('finds a row by a timestamp it answered with, offset and all', async () => {
		await insertRows(EVERYTHING, 'tag', { name: 'Travel', normalised_name: 'travel' }, testDb);
		const [tag] = (await listRows(EVERYTHING, 'tag', query({}), testDb)).rows;
		const found = await listRows(
			EVERYTHING,
			'tag',
			query({ created_at: tag.created_at as string }),
			testDb
		);
		expect(found.rows.map((row) => row.id)).toEqual([tag.id]);

		await updateRow(
			EVERYTHING,
			'tag',
			query({ id: tag.id as string }),
			{ created_at: '2026-09-27T10:00:00.123+02:00' },
			testDb
		);
		// As a query string arrives: its `+` reads as a space.
		const spaced = new URLSearchParams('created_at=2026-09-27T10:00:00.123+02:00');
		expect((await listRows(EVERYTHING, 'tag', spaced, testDb)).total).toBe(1);
	});

	// 0050 would be stored and read back by the driver as 1950.
	it('refuses a timestamp the driver would read back as another year', async () => {
		const refused = await refusal(
			insertRows(
				EVERYTHING,
				'tag',
				{ name: 'Old', normalised_name: 'old', created_at: '0050-01-01T00:00:00Z' },
				testDb
			)
		);
		expect(refused.status).toBe(400);
		expect((await listRows(EVERYTHING, 'tag', query({}), testDb)).total).toBe(0);
	});

	it('takes a page size in digits only', async () => {
		for (const limit of ['', '0x10', '1e2', '-1']) {
			expect(
				(await refusal(listRows(EVERYTHING, 'trip', query({ limit }), testDb))).status,
				limit
			).toBe(400);
		}
	});

	it('carries money as whole minor units, as the rest of the API does', async () => {
		const txn = await makeTransaction(testDb, { amountMinor: -123456n });
		const { rows } = await listRows(EVERYTHING, 'transaction', query({ id: txn.id }), testDb);
		expect(rows[0].amount_minor).toBe(-123456);
	});
});

describe('rows the app depends on', () => {
	it('fixes a shelf key once the shelf exists, and keeps a system shelf', async () => {
		const [shelf] = await insertRows(
			EVERYTHING,
			'shelf',
			{ key: 'boats', label: 'Boats', template: 'dossier', unit: 'subject', question: 'Which?' },
			testDb
		);
		const moved = await refusal(
			updateRow(EVERYTHING, 'shelf', query({ id: shelf.id as string }), { key: 'x' }, testDb)
		);
		expect(moved.message).toMatch(/fixed/);
		await deleteRow(EVERYTHING, 'shelf', query({ id: shelf.id as string }), testDb);

		const [inbox] = await testDb
			.select({ id: schema.shelf.id })
			.from(schema.shelf)
			.where(eq(schema.shelf.key, 'inbox'));
		const kept = await refusal(deleteRow(EVERYTHING, 'shelf', query({ id: inbox.id }), testDb));
		expect(kept.status).toBe(409);
		expect(kept.message).toMatch(/system shelf/);
	});

	it('keeps a built-in document type and deletes a household one', async () => {
		const kept = await refusal(
			deleteRow(EVERYTHING, 'document_type', query({ key: 'payslip' }), testDb)
		);
		expect(kept.status).toBe(409);
		await insertRows(
			EVERYTHING,
			'document_type',
			{ key: 'boat_papers', label: 'Boat papers' },
			testDb
		);
		expect(
			await deleteRow(EVERYTHING, 'document_type', query({ key: 'boat_papers' }), testDb)
		).toMatchObject({ key: 'boat_papers', builtin: false });
	});

	it('removes a member but never an administrator', async () => {
		const admin = await makePerson(testDb, { name: 'Ada Admin', role: 'admin' });
		const member = await makePerson(testDb, { name: 'Max Member', role: 'member' });
		const refused = await refusal(deleteRow(EVERYTHING, 'person', query({ id: admin.id }), testDb));
		expect(refused.status).toBe(409);
		expect(refused.message).toMatch(/Settings/);
		expect(await deleteRow(EVERYTHING, 'person', query({ id: member.id }), testDb)).toMatchObject({
			id: member.id
		});
	});

	// The sweep deletes a removed trip a minute after `removed_at`; any other
	// time would skip that minute or hide the trip for good.
	it('stamps removed_at with the time of the call, whatever time is sent', async () => {
		const [trip] = await insertRows(EVERYTHING, 'trip', holiday, testDb);
		const before = Date.now();
		for (const sent of ['2000-01-01T00:00:00Z', '2999-01-01T00:00:00Z']) {
			const removed = await updateRow(
				EVERYTHING,
				'trip',
				query({ id: trip.id as string }),
				{ removed_at: sent },
				testDb
			);
			const at = Date.parse(removed.removed_at as string);
			expect(at).toBeGreaterThanOrEqual(before - 1000);
			expect(at).toBeLessThanOrEqual(Date.now() + 1000);
		}
		const restored = await updateRow(
			EVERYTHING,
			'trip',
			query({ id: trip.id as string }),
			{ removed_at: null },
			testDb
		);
		expect(restored.removed_at).toBeNull();
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

	// A document is an entity, so a link, a lane or a tag pointing at "any
	// record" can point at a payslip through its target as well.
	it('keeps a payslip out of the far end of a link too', async () => {
		const { payslip, lease } = await filed();
		const linked = await refusal(
			insertRows(ARCHIVE, 'document_link', { document_id: lease.id, target_id: payslip.id }, testDb)
		);
		expect(linked.status).toBe(403);

		await makeDocumentLink(testDb, { documentId: lease.id, targetId: payslip.id });
		const links = await listRows(ARCHIVE, 'document_link', query({}), testDb);
		expect(links.rows.map((row) => row.target_id)).not.toContain(payslip.id);
		expect((await listRows(PAYROLL, 'document_link', query({}), testDb)).rows).toContainEqual({
			document_id: lease.id,
			target_id: payslip.id
		});
	});
});
