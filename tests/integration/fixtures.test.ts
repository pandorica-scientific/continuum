// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { documentLink, transaction } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import {
	FIXTURE_CURRENCY,
	asAdmin,
	asMember,
	makeAccount,
	makeDocument,
	makeDocumentLink,
	makeLoan,
	makePerson,
	makeProperty,
	makeTransaction,
	rowId,
	session
} from './fixtures';

/**
 * The builders are about to carry most of the suite's rows, so what they
 * default to is now a shared assumption. Pin it here rather than discovering
 * it from a failure three suites away.
 */
let harness: Harness;
let db: TestDb;

beforeAll(async () => {
	harness = await startPostgres('fixtures', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
	db = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate document, account, person, property, loan cascade`;
});

describe('row builders', () => {
	it('opens an account a test said nothing about', async () => {
		const row = await makeAccount(db);
		expect(row.currency).toBe(FIXTURE_CURRENCY);
		expect(row.name).toBeTypeOf('string');
	});

	it('lets a test name only the column it is about', async () => {
		const row = await makeAccount(db, { currency: 'EUR' });
		expect(row.currency).toBe('EUR');
		expect(row.bank).toBeTypeOf('string');
	});

	it('derives a person’s initials from the name it was given', async () => {
		expect((await makePerson(db, { name: 'Jan Novák' })).initials).toBe('JN');
	});

	it('gives two unnamed people different ids rather than colliding', async () => {
		const [a, b] = [await makePerson(db), await makePerson(db)];
		expect(a.id).not.toBe(b.id);
	});

	it('takes a stable id when a test needs the same value twice', async () => {
		const id = rowId('fixtures-account');
		expect((await makeAccount(db, { id })).id).toBe(id);
	});

	it('opens an account for a transaction handed none', async () => {
		const row = await makeTransaction(db);
		expect(row.accountId).not.toBeNull();
	});

	it('files a transaction against an account it was handed', async () => {
		const account = await makeAccount(db, { name: 'Named' });
		const row = await makeTransaction(db, { accountId: account.id, amountMinor: 500_00n });
		expect(row.accountId).toBe(account.id);
		expect(row.amountMinor).toBe(500_00n);
	});

	it('gives two transactions fingerprints that do not collide on one account', async () => {
		// The unique index is on (accountId, dedupFingerprint); a shared default
		// would fail every suite that books twice.
		const account = await makeAccount(db);
		await makeTransaction(db, { accountId: account.id });
		await makeTransaction(db, { accountId: account.id });
		const rows = await db.select().from(transaction).where(eq(transaction.accountId, account.id));
		expect(rows).toHaveLength(2);
	});

	it('puts a document on the inbox shelf without the test naming a uuid', async () => {
		expect((await makeDocument(db)).shelfId).toBeTypeOf('string');
	});

	it('files a document on the shelf a test names by key', async () => {
		const inbox = await makeDocument(db, { shelfKey: 'inbox' });
		const statements = await makeDocument(db, { shelfKey: 'statements' });
		expect(inbox.shelfId).not.toBe(statements.shelfId);
	});

	it('links a document to a record, creating both ends when given neither', async () => {
		const link = await makeDocumentLink(db);
		expect(link.documentId).toBeTypeOf('string');
		expect(link.targetId).toBeTypeOf('string');
	});

	it('links against any record kind, because the target is an entity', async () => {
		// A loan and a property are different tables; both register as entities by
		// trigger, which is what makes one link table enough.
		const doc = await makeDocument(db);
		const loan = await makeLoan(db);
		const flat = await makeProperty(db);
		await makeDocumentLink(db, { documentId: doc.id, targetId: loan.id });
		await makeDocumentLink(db, { documentId: doc.id, targetId: flat.id });
		const links = await db.select().from(documentLink).where(eq(documentLink.documentId, doc.id));
		expect(links).toHaveLength(2);
	});
});

describe('sessions', () => {
	it('gives an admin and a member the shape a loader reads', () => {
		expect(asAdmin.person.role).toBe('admin');
		expect(asMember.person.role).toBe('member');
		expect(asAdmin.person.theme).toBeNull();
	});

	it('takes a fixed id so a session can own a row', () => {
		const id = rowId('fixtures-admin');
		expect(session('admin', { id }).person.id).toBe(id);
	});

	it('gives the shared sessions a derived id rather than a fresh one each read', () => {
		// Two reads of the same constant must name the same person, or a row
		// owned in setup is owned by nobody at assertion time.
		expect(asAdmin.person.id).toBe(asAdmin.person.id);
		expect(asAdmin.person.id).not.toBe(asMember.person.id);
	});
});
