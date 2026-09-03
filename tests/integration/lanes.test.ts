// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The lanes an organisation is created with, and the ones a household adds.
 *
 * Presets, not rules. `shelf_type` does the same for a shelf's type list: the
 * app's guess at what an employer sends is a good one and it is still a guess,
 * and the household filing the paper knows better by the second week.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { addLane, addOrganisation, lanesFor } from '$lib/server/organisations/mutations';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

/** Income & Tax, resolved by key: an organisation belongs to a shelf now. */
const incomeTaxShelf = (handle: Parameters<typeof shelfIdByKey>[1]) =>
	shelfIdByKey('income_tax', handle);

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let db: TestDb;
let previousUrl: string | undefined;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('lanes', { max: 1 });
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
	await harness.sql`truncate organisation cascade`;
});

describe('lanes', () => {
	it('seeds an employer with the three lanes an employer has', async () => {
		const org = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Institute', kind: 'employer' },
			db
		);
		const lanes = await lanesFor(org.id, db);
		expect(lanes.map((l) => `${l.label}:${l.cadence}`)).toEqual([
			'Payslips:monthly',
			'Once a year · declaration, annual settlement:yearly',
			'Changes to pay:none'
		]);
	});

	it('seeds an authority with its two', async () => {
		const org = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Tax office', kind: 'authority' },
			db
		);
		expect((await lanesFor(org.id, db)).map((l) => l.cadence)).toEqual(['yearly', 'none']);
	});

	it('seeds nothing for a kind with no rhythm of its own', async () => {
		const org = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Someone', kind: 'other' },
			db
		);
		expect(await lanesFor(org.id, db)).toEqual([]);
	});

	it('does not seed a second set over a household that has edited theirs', async () => {
		// `addOrganisation` is idempotent by name. Seeding again on the second call
		// would put the app's guess back on top of the household's answer.
		const first = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Institute', kind: 'employer' },
			db
		);
		await addOrganisation({ shelfId: await incomeTaxShelf(db), name: 'institute' }, db);
		expect(await lanesFor(first.id, db)).toHaveLength(3);
	});

	it('goes with the organisation', async () => {
		const org = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Gone Ltd', kind: 'employer' },
			db
		);
		await harness.sql`delete from organisation where id = ${org.id}`;
		expect(await lanesFor(org.id, db)).toEqual([]);
	});

	it('lets the household add one of its own', async () => {
		const org = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Insurer', kind: 'insurer' },
			db
		);
		await addLane({ entityId: org.id, label: 'Annual statement', cadence: 'yearly' }, db);
		expect((await lanesFor(org.id, db)).map((l) => l.label)).toContain('Annual statement');
	});
});
