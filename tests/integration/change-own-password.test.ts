// SPDX-License-Identifier: AGPL-3.0-or-later
import { rowId } from '../row-id';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makePerson } from './fixtures';
import { hashPassword, verifyPassword } from '$lib/server/auth';
import { changeOwnPassword } from '$lib/server/auth/password';
import { resetDbResolver, setDbResolver } from '$lib/server/db';

let harness: Harness;
let testDb: TestDb;
const NO_PASSWORD = rowId('person-nopass');
const HAS_PASSWORD = rowId('person-haspass');

beforeAll(async () => {
	harness = await startPostgres('change-own-password');
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
	// changeOwnPassword reads the module-level `db` singleton rather than
	// taking a handle, so it needs the resolver seam pointed at this harness.
	setDbResolver(() => testDb);
}, 120_000);

afterAll(async () => {
	resetDbResolver();
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`truncate person cascade`;
	await makePerson(testDb, {
		id: NO_PASSWORD,
		name: 'Pending',
		initials: 'P',
		role: 'admin',
		passwordHash: null
	});
	await makePerson(testDb, {
		id: HAS_PASSWORD,
		name: 'Jana',
		initials: 'J',
		role: 'admin',
		passwordHash: await hashPassword('correct-horse-battery')
	});
});

describe('changeOwnPassword', () => {
	it('sets a first password with no current one to check — open mode, or still pending', async () => {
		const result = await changeOwnPassword(NO_PASSWORD, '', 'new-and-long-enough', null);
		expect(result).toEqual({ ok: true });
		const [row] = await testDb
			.select()
			.from(schema.person)
			.where(eq(schema.person.id, NO_PASSWORD));
		expect(row?.passwordHash).not.toBeNull();
		expect(await verifyPassword(row!.passwordHash, 'new-and-long-enough')).toBe(true);
	});

	it('requires the right current password when one already exists', async () => {
		const result = await changeOwnPassword(HAS_PASSWORD, 'wrong', 'new-and-long-enough', null);
		expect(result).toEqual({ ok: false, message: 'Current password is wrong.' });
	});

	it('changes the password when the current one is right', async () => {
		const result = await changeOwnPassword(
			HAS_PASSWORD,
			'correct-horse-battery',
			'new-and-long-enough',
			null
		);
		expect(result).toEqual({ ok: true });
		const [row] = await testDb
			.select()
			.from(schema.person)
			.where(eq(schema.person.id, HAS_PASSWORD));
		expect(await verifyPassword(row!.passwordHash, 'new-and-long-enough')).toBe(true);
	});
});
