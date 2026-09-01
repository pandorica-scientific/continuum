// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * A person's role periods with an organisation.
 *
 * The case worth holding is a PROMOTION. It is a second period, not an edit to
 * the first, and the reason is arithmetic rather than sentiment: a lane on the
 * Income & Tax shelf counts the filings it expected from when the relationship
 * began, so overwriting the role would move that start forward and quietly
 * erase every missing year before it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentRole, engagementSpan, engagementsFor } from '$lib/server/organisations/engagements';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeEngagement, makeOrganisation, makePerson } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let db: TestDb;
let previousUrl: string | undefined;

const TODAY = '2026-09-01';

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('engagements', { max: 1 });
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
	await harness.sql`truncate person cascade`;
});

describe('an engagement', () => {
	it('records a promotion as a second period, not a second job', async () => {
		const org = await makeOrganisation(db, { name: 'Institute of Physics CAS' });
		const person = await makePerson(db, { name: 'Robert' });
		await makeEngagement(db, {
			organisationId: org.id,
			personId: person.id,
			role: 'PhD student',
			startsOn: '2018-09-01',
			endsOn: '2021-08-31'
		});
		await makeEngagement(db, {
			organisationId: org.id,
			personId: person.id,
			role: 'Research scientist',
			startsOn: '2021-09-01'
		});

		const rows = await engagementsFor(org.id, db);
		// 2018, not 2021: the span is the employment, and a lane counts from it.
		expect(engagementSpan(rows)).toEqual({ startsOn: '2018-09-01', endsOn: null });
		expect(currentRole(rows, TODAY)).toBe('Research scientist');
	});

	it('says a relationship has ended only once every period has closed', async () => {
		const org = await makeOrganisation(db, { name: 'Old Employer' });
		const person = await makePerson(db, { name: 'Robert' });
		await makeEngagement(db, {
			organisationId: org.id,
			personId: person.id,
			startsOn: '2015-01-01',
			endsOn: '2018-06-30'
		});
		const rows = await engagementsFor(org.id, db);
		expect(engagementSpan(rows)).toEqual({ startsOn: '2015-01-01', endsOn: '2018-06-30' });
		expect(currentRole(rows, TODAY)).toBeNull();
	});

	it('stays current while one period is still open, whatever the others say', async () => {
		// Two jobs at one employer, the first closed and the second running. The
		// relationship has not ended, and reporting the closed date would tell a
		// lane to stop expecting filings that are still arriving.
		const org = await makeOrganisation(db, { name: 'Institute of Physics CAS' });
		const person = await makePerson(db, { name: 'Robert' });
		await makeEngagement(db, {
			organisationId: org.id,
			personId: person.id,
			startsOn: '2018-09-01',
			endsOn: '2021-08-31'
		});
		await makeEngagement(db, {
			organisationId: org.id,
			personId: person.id,
			startsOn: '2021-09-01'
		});
		expect(engagementSpan(await engagementsFor(org.id, db)).endsOn).toBeNull();
	});

	it('works for a relationship nobody dated', async () => {
		// An authority a household has simply always dealt with. A lane then falls
		// back to the earliest filed document, exactly as the coverage ribbon falls
		// back to an account's first movement.
		const org = await makeOrganisation(db, { name: 'Tax office', kind: 'authority' });
		const person = await makePerson(db, { name: 'Robert' });
		await makeEngagement(db, { organisationId: org.id, personId: person.id });
		const rows = await engagementsFor(org.id, db);
		expect(engagementSpan(rows)).toEqual({ startsOn: null, endsOn: null });
		// Undated is current, not absent: it runs from for ever.
		expect(currentRole(rows, TODAY)).toBeNull();
	});

	it('refuses a period that ends before it starts', async () => {
		const org = await makeOrganisation(db, { name: 'Backwards Ltd' });
		const person = await makePerson(db, { name: 'Robert' });
		await expect(
			makeEngagement(db, {
				organisationId: org.id,
				personId: person.id,
				startsOn: '2021-01-01',
				endsOn: '2020-01-01'
			})
		).rejects.toThrow();
	});

	it('goes with the organisation when it is deleted', async () => {
		// A role period has no meaning without the organisation it was with.
		const org = await makeOrganisation(db, { name: 'Gone Ltd' });
		const person = await makePerson(db, { name: 'Robert' });
		await makeEngagement(db, { organisationId: org.id, personId: person.id });
		await harness.sql`delete from organisation where id = ${org.id}`;
		expect(await engagementsFor(org.id, db)).toEqual([]);
	});
});
