// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The Income & Tax shelf read as counterparty cards.
 *
 * The claim worth holding is that a lane counts from the ENGAGEMENT and not
 * from the paper: a year before the first filed document still reads as
 * missing, which is the only reason role periods exist and the one thing a
 * flat list can never say.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCounterparties } from '$lib/server/organisations/counterparties-load';
import { addEngagement, addOrganisation } from '$lib/server/organisations/mutations';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeDocumentLink, makePerson } from './fixtures';

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
	harness = await startPostgres('counterparties-load', { max: 1 });
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

/** An employer with a person, an engagement, and a payslip per month given. */
async function employerWith(months: string[], since: string | null) {
	const org = await addOrganisation({ name: 'Institute', kind: 'employer' }, db);
	const person = await makePerson(db, { name: 'Robert' });
	await addEngagement(
		{ organisationId: org.id, personId: person.id, role: 'Analyst', startsOn: since },
		db
	);
	const shelfId = await shelfIdByKey('finance', db);
	for (const month of months) {
		const doc = await makeDocument(db, {
			name: `Payslip ${month}`,
			shelfId,
			type: 'payslip',
			periodOn: `${month}-01`
		});
		await makeDocumentLink(db, { documentId: doc.id, targetId: org.id });
	}
	return org;
}

describe('loadCounterparties', () => {
	it('counts a lane from the engagement, not from the first payslip', async () => {
		// The whole argument for role periods. Employment began in January and the
		// earliest slip is June, so January to May are gaps — and a shelf that
		// counted from the paper would report a full year.
		await employerWith(['2026-06', '2026-07', '2026-08'], '2026-01-01');
		const { cards } = await loadCounterparties(2026, TODAY, db);
		const payslips = cards[0].lanes.find((l) => l.label === 'Payslips')!;

		expect(payslips.cadence).toBe('monthly');
		expect(payslips.filed).toBe(3);
		// January through September inclusive: the current month is expected but
		// never counted missing.
		expect(payslips.expected).toBe(9);
		expect(payslips.boxes.filter((b) => b.state === 'gap').map((b) => b.startMonth)).toEqual([
			0, 1, 2, 3, 4
		]);
	});

	it('names the current role and when the whole thing began', async () => {
		await employerWith(['2026-08'], '2021-09-01');
		const [card] = (await loadCounterparties(2026, TODAY, db)).cards;
		expect(card.role).toBe('Analyst');
		expect(card.since).toBe('2021-09-01');
	});

	it('gives a no-cadence lane a list and no cells', async () => {
		// Paper with no rhythm has nothing to be missing from, and a grid over it
		// would invent an expectation nobody stated.
		const org = await addOrganisation({ name: 'Institute', kind: 'employer' }, db);
		const doc = await makeDocument(db, {
			name: 'Contract amendment',
			shelfId: await shelfIdByKey('finance', db),
			type: 'contract'
		});
		await makeDocumentLink(db, { documentId: doc.id, targetId: org.id });

		const [card] = (await loadCounterparties(2026, TODAY, db)).cards;
		const changes = card.lanes.find((l) => l.label === 'Changes to pay')!;
		expect(changes.boxes).toEqual([]);
		expect(changes.documents.map((d) => d.name)).toEqual(['Contract amendment']);
		expect(changes.gaps).toBe(0);
	});

	it('puts a document in exactly one lane, the first that claims it', async () => {
		// Otherwise a payslip appears twice and the unclaimed count is wrong in
		// both directions at once.
		await employerWith(['2026-08'], '2026-01-01');
		const [card] = (await loadCounterparties(2026, TODAY, db)).cards;
		const appearances = card.lanes.flatMap((l) => l.documents.map((d) => d.id));
		expect(new Set(appearances).size).toBe(appearances.length);
		expect(card.unclaimed).toEqual([]);
	});

	it('counts a document no lane claims rather than dropping it', async () => {
		// An organisation whose kind seeds no lanes at all: every document filed
		// against it is unclaimed, and the card has to say so.
		const org = await addOrganisation({ name: 'Someone', kind: 'other' }, db);
		const doc = await makeDocument(db, { name: 'A letter', type: 'correspondence' });
		await makeDocumentLink(db, { documentId: doc.id, targetId: org.id });

		const [card] = (await loadCounterparties(2026, TODAY, db)).cards;
		expect(card.lanes).toEqual([]);
		expect(card.unclaimed.map((d) => d.name)).toEqual(['A letter']);
	});

	it('leaves out an organisation nobody has used', async () => {
		// A record somebody created and never filed against. A card of empty lanes
		// for it is noise, and the record is still in the rail.
		await addOrganisation({ name: 'Unused', kind: 'other' }, db);
		expect((await loadCounterparties(2026, TODAY, db)).cards).toEqual([]);
	});

	it('hides a restricted document from a member, as every other read does', async () => {
		const org = await addOrganisation({ name: 'Institute', kind: 'employer' }, db);
		const shelfId = await shelfIdByKey('finance', db);
		for (const sensitivity of ['normal', 'restricted'] as const) {
			const doc = await makeDocument(db, {
				shelfId,
				type: 'payslip',
				sensitivity,
				periodOn: '2026-08-01'
			});
			await makeDocumentLink(db, { documentId: doc.id, targetId: org.id });
		}

		const asMember = await loadCounterparties(2026, TODAY, db, { id: 'm', role: 'member' });
		const asAdmin = await loadCounterparties(2026, TODAY, db, { id: 'a', role: 'admin' });
		expect(asMember.cards[0].lanes.find((l) => l.label === 'Payslips')!.filed).toBe(1);
		expect(asAdmin.cards[0].lanes.find((l) => l.label === 'Payslips')!.filed).toBe(2);
	});

	it('draws a yearly lane in decades, counting from the engagement', async () => {
		const org = await addOrganisation({ name: 'Tax office', kind: 'authority' }, db);
		const person = await makePerson(db, { name: 'Robert' });
		await addEngagement(
			{ organisationId: org.id, personId: person.id, startsOn: '2023-01-01' },
			db
		);
		const doc = await makeDocument(db, {
			name: 'Tax return 2025',
			shelfId: await shelfIdByKey('finance', db),
			type: 'tax_document',
			periodOn: '2025-01-01',
			periodEndOn: '2025-12-31'
		});
		await makeDocumentLink(db, { documentId: doc.id, targetId: org.id });

		const [card] = (await loadCounterparties(2026, TODAY, db)).cards;
		const returns = card.lanes.find((l) => l.label === 'Tax return')!;
		// 2020–2029, so 2023 and 2024 are gaps and 2025 is filed.
		expect(returns.boxes[5]).toMatchObject({ state: 'filed', documentIds: [doc.id] });
		expect(returns.boxes.filter((b) => b.state === 'gap').map((b) => b.startMonth)).toEqual([3, 4]);
		// 2023 through 2026 inclusive.
		expect(returns.expected).toBe(4);
	});
});
