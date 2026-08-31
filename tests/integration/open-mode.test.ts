// SPDX-License-Identifier: AGPL-3.0-or-later
import { rowId } from '../row-id';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makePerson } from './fixtures';
import { disableOpenMode, enableOpenMode, isOpenMode } from '$lib/server/auth/open-mode';
import { hashPassword } from '$lib/server/auth';

let harness: Harness;
let testDb: TestDb;
const ADMIN = rowId('person-admin');
const MEMBER = rowId('person-member');
const NO_PASSWORD = rowId('person-nopass');

beforeAll(async () => {
	harness = await startPostgres('open-mode');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 120_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate person cascade`;
	await harness.sql`delete from settings where key = 'openMode'`;
	const hash = await hashPassword('correct-horse-battery');
	await makePerson(testDb, {
		id: ADMIN,
		name: 'Jana',
		initials: 'J',
		role: 'admin',
		passwordHash: hash
	});
	await makePerson(testDb, {
		id: MEMBER,
		name: 'Jan',
		initials: 'J',
		role: 'member',
		passwordHash: hash
	});
	await makePerson(testDb, {
		id: NO_PASSWORD,
		name: 'Pending',
		initials: 'P',
		role: 'admin',
		passwordHash: null
	});
});

describe('open mode', () => {
	it('is off until somebody turns it on', async () => {
		expect(await isOpenMode(testDb)).toBe(false);
	});

	it('an administrator turns it on with their own password', async () => {
		const result = await enableOpenMode(ADMIN, 'correct-horse-battery', testDb);
		expect(result.ok).toBe(true);
		expect(await isOpenMode(testDb)).toBe(true);
	});

	it('refuses the wrong password', async () => {
		const result = await enableOpenMode(ADMIN, 'not-the-password', testDb);
		expect(result).toEqual({ ok: false, status: 403, message: 'That password is not right.' });
		expect(await isOpenMode(testDb)).toBe(false);
	});

	it('refuses a member, however right their password is', async () => {
		const result = await enableOpenMode(MEMBER, 'correct-horse-battery', testDb);
		expect(result).toEqual({
			ok: false,
			status: 403,
			message: 'Only an administrator can do that.'
		});
		expect(await isOpenMode(testDb)).toBe(false);
	});

	it('refuses an administrator who has no password to prove intent with', async () => {
		const result = await enableOpenMode(NO_PASSWORD, '', testDb);
		expect(result).toEqual({
			ok: false,
			status: 400,
			message: 'Set a password before turning this on.'
		});
		expect(await isOpenMode(testDb)).toBe(false);
	});

	it('can always be turned off, by anyone, with no credential', async () => {
		await enableOpenMode(ADMIN, 'correct-horse-battery', testDb);
		// Once the door is open anyone inside could close it anyway; demanding a
		// credential to close it would only stop the honest.
		expect((await disableOpenMode(testDb)).ok).toBe(true);
		expect(await isOpenMode(testDb)).toBe(false);
	});

	it('leaves every password intact, so turning it off restores normal sign-in', async () => {
		await enableOpenMode(ADMIN, 'correct-horse-battery', testDb);
		await disableOpenMode(testDb);
		const people = await testDb.select().from(schema.person);
		expect(people.every((p) => p.id === NO_PASSWORD || p.passwordHash !== null)).toBe(true);
	});
});
