// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Proposing an organisation, and recording what happened.
 *
 * The proposals themselves are computed rather than stored, so what this suite
 * holds is the pair of writes: accepting files the document AND records that
 * the lane was right, dismissing files nothing AND records that it was wrong.
 * A link written without the count would leave a lane that is always right
 * looking as though it had never proposed anything.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { lane } from '$lib/server/db/schema';
import {
	acceptProposal,
	dismissProposal,
	loadProposals
} from '$lib/server/organisations/proposals-load';
import { addOrganisation, lanesFor } from '$lib/server/organisations/mutations';
import { documentsAbout } from '$lib/server/documents/targets';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makeDocument, makeDocumentLink } from './fixtures';

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
	harness = await startPostgres('lane-proposals', { max: 1 });
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
});

const aPayslip = async () =>
	makeDocument(db, {
		name: 'Payslip 2026-08',
		shelfId: await shelfIdByKey('income_tax', db),
		type: 'payslip'
	});

describe('proposals', () => {
	it('proposes the employer for an unfiled payslip', async () => {
		const org = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Institute', kind: 'employer' },
			db
		);
		const doc = await aPayslip();

		const [proposal] = await loadProposals(db);
		expect(proposal.documentId).toBe(doc.id);
		expect(proposal.organisationId).toBe(org.id);
		expect(proposal.laneLabel).toBe('Payslips');
	});

	it('says nothing about a document already filed against an organisation', async () => {
		// It has an answer. Proposing a second would be arguing with it.
		const org = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Institute', kind: 'employer' },
			db
		);
		const doc = await aPayslip();
		await makeDocumentLink(db, { documentId: doc.id, targetId: org.id });
		expect(await loadProposals(db)).toEqual([]);
	});

	it('says nothing when two employers both claim it', async () => {
		await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Institute', kind: 'employer' },
			db
		);
		await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Another employer', kind: 'employer' },
			db
		);
		await aPayslip();
		expect(await loadProposals(db)).toEqual([]);
	});

	it('files the document and records that the lane was right', async () => {
		const org = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Institute', kind: 'employer' },
			db
		);
		const doc = await aPayslip();
		const [proposal] = await loadProposals(db);

		const result = await acceptProposal(
			proposal.documentId,
			proposal.laneId,
			proposal.organisationId,
			{ id: 'a', role: 'admin' },
			db
		);
		expect(result.ok).toBe(true);
		expect((await documentsAbout(org.id, null, db)).map((d) => d.id)).toEqual([doc.id]);

		const [row] = await db.select().from(lane).where(eq(lane.id, proposal.laneId));
		expect(row.acceptedCount).toBe(1);
		expect(row.correctedCount).toBe(0);

		// And it stops being proposed, because it now has an answer.
		expect(await loadProposals(db)).toEqual([]);
	});

	it('files nothing and records that the lane was wrong', async () => {
		const org = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Institute', kind: 'employer' },
			db
		);
		await aPayslip();
		const [proposal] = await loadProposals(db);
		await dismissProposal(proposal.laneId, db);

		expect(await documentsAbout(org.id, null, db)).toEqual([]);
		const [row] = await db.select().from(lane).where(eq(lane.id, proposal.laneId));
		expect(row.correctedCount).toBe(1);
	});

	it('falls silent once corrections outnumber acceptances', async () => {
		// Nobody has to notice a bad lane and disable it, which is the only way a
		// rule nobody is watching stops doing damage.
		const org = await addOrganisation(
			{ shelfId: await incomeTaxShelf(db), name: 'Institute', kind: 'employer' },
			db
		);
		await aPayslip();
		const lanes = await lanesFor(org.id, db);
		const payslips = lanes.find((l) => l.label === 'Payslips')!;

		await dismissProposal(payslips.id, db);
		expect(await loadProposals(db)).toEqual([]);
	});
});
