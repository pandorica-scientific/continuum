// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Creating and editing organisations and role periods.
 *
 * Every refusal here is one a SUBJECT already makes, and that is the assertion
 * worth making: two records a household creates by name should not behave
 * differently depending on which screen minted them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import {
	addEngagement,
	addOrganisation,
	deleteOrganisation,
	endEngagement,
	listOrganisations,
	renameOrganisation,
	ORGANISATION_IN_USE,
	ORGANISATION_NAME_TAKEN
} from '$lib/server/organisations/mutations';
import { engagementsFor } from '$lib/server/organisations/engagements';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeDocumentLink, makeOrganisation, makePerson } from './fixtures';

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
	harness = await startPostgres('organisation-mutations', { max: 1 });
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
	await harness.sql`truncate document cascade`;
	await harness.sql`truncate person cascade`;
});

describe('adding an organisation', () => {
	it('finds the one that already answers to that name', async () => {
		// Idempotent rather than an error: two people adding "Tax office" on two
		// devices have agreed, not collided. `upsertSubjectByName` reads the same.
		const first = await addOrganisation({ shelfId: await incomeTaxShelf(db), name: 'Tax office', kind: 'authority' }, db);
		const again = await addOrganisation({ shelfId: await incomeTaxShelf(db), name: '  tax   office ' }, db);
		expect(again.id).toBe(first.id);
		// And the second call does not overwrite what the first decided.
		expect(again.kind).toBe('authority');
	});

	it('refuses a name with nothing in it', async () => {
		await expect(addOrganisation({ shelfId: await incomeTaxShelf(db), name: '   ' }, db)).rejects.toThrow();
	});

	it('says so when a rename would collide', async () => {
		const a = await addOrganisation({ shelfId: await incomeTaxShelf(db), name: 'Institute of Physics CAS' }, db);
		await addOrganisation({ shelfId: await incomeTaxShelf(db), name: 'Tax office' }, db);
		await expect(renameOrganisation(a.id, 'tax office', db)).rejects.toThrow(
			ORGANISATION_NAME_TAKEN
		);
	});
});

describe('removing an organisation', () => {
	it('refuses while paper is still filed against it', async () => {
		// The same rule a shelf keeps: a document must always be somewhere, and
		// deleting the employer out from under a payslip is not a delete anybody
		// asked for.
		const org = await addOrganisation({ shelfId: await incomeTaxShelf(db), name: 'Institute of Physics CAS' }, db);
		const doc = await makeDocument(db, { type: 'payslip' });
		await makeDocumentLink(db, { documentId: doc.id, targetId: org.id });
		await expect(deleteOrganisation(org.id, db)).rejects.toThrow(ORGANISATION_IN_USE);
	});

	it('takes its role periods with it once nothing is filed', async () => {
		const org = await addOrganisation({ shelfId: await incomeTaxShelf(db), name: 'Gone Ltd' }, db);
		const person = await makePerson(db, { name: 'Robert' });
		await addEngagement({ organisationId: org.id, personId: person.id }, db);
		await deleteOrganisation(org.id, db);
		expect(await engagementsFor(org.id, db)).toEqual([]);
	});
});

describe('role periods', () => {
	it('closes one rather than deleting it', async () => {
		// History is the point. A period removed on promotion takes its years with
		// it, and a lane's expected count silently shrinks.
		const org = await addOrganisation({ shelfId: await incomeTaxShelf(db), name: 'Institute of Physics CAS' }, db);
		const person = await makePerson(db, { name: 'Robert' });
		const role = await addEngagement(
			{
				organisationId: org.id,
				personId: person.id,
				role: 'PhD student',
				startsOn: '2018-09-01'
			},
			db
		);
		await endEngagement(role.id, '2021-08-31', db);

		const [row] = await engagementsFor(org.id, db);
		expect(row.endsOn).toBe('2021-08-31');
		expect(row.role).toBe('PhD student');
	});
});

describe('listing organisations', () => {
	it('counts the paper filed against each, and the people who worked there', async () => {
		const employer = await makeOrganisation(db, { name: 'AAA Institute', kind: 'employer' });
		const empty = await makeOrganisation(db, { name: 'ZZZ Nothing Filed' });
		const person = await makePerson(db, { name: 'Robert' });
		await addEngagement({ organisationId: employer.id, personId: person.id }, db);
		await addEngagement({ organisationId: employer.id, personId: person.id, role: 'Promoted' }, db);
		for (const month of ['2026-07', '2026-08']) {
			const doc = await makeDocument(db, { name: `Payslip ${month}`, type: 'payslip' });
			await makeDocumentLink(db, { documentId: doc.id, targetId: employer.id });
		}

		const rows = await listOrganisations(db);
		const filed = rows.find((r) => r.id === employer.id)!;
		expect(filed.documentCount).toBe(2);
		// Two role periods, one person: a promotion is not a second colleague.
		expect(filed.peopleCount).toBe(1);
		// One nothing is filed against is a zero, not an absence.
		expect(rows.find((r) => r.id === empty.id)!.documentCount).toBe(0);
	});

	it('hides a restricted document from a member, exactly as every other count does', async () => {
		const org = await makeOrganisation(db, { name: 'Institute' });
		for (const sensitivity of ['normal', 'restricted'] as const) {
			const doc = await makeDocument(db, { type: 'payslip', sensitivity });
			await makeDocumentLink(db, { documentId: doc.id, targetId: org.id });
		}
		const asMember = await listOrganisations(db, { id: 'm', role: 'member' });
		const asAdmin = await listOrganisations(db, { id: 'a', role: 'admin' });
		expect(asMember[0].documentCount).toBe(1);
		expect(asAdmin[0].documentCount).toBe(2);
	});
});
