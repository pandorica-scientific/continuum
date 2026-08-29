// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import {
	document,
	documentLink,
	loan,
	loanFixationPeriod,
	property,
	tenancy
} from '$lib/server/db/schema';
import { shelfIdByKey } from '$lib/server/documents/shelves';
import { buildBriefing } from '$lib/server/briefing';
import { generateEvents } from '$lib/server/calendar';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';

/**
 * D7: the record owns the deadline.
 *
 * A lease contract's `expires_on` and the tenancy's own `ends_on` describe the
 * same fact twice when they agree — the demo seed used to ship exactly that,
 * and both the Overview and the calendar reminded twice for one lease ending.
 * `documentExpiry` (the briefing source) reads the module-level `db`
 * singleton, not a handle, so it has to be pointed at this harness the same
 * way `restricted-read-paths.test.ts` and `archive-scope.test.ts` do it —
 * `generateEvents` takes an explicit handle and needs none of this.
 */
vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
let previousUrl: string | undefined;

beforeAll(async () => {
	previousUrl = process.env.DATABASE_URL;
	harness = await startPostgres('deadlines', { max: 1 });
	process.env.DATABASE_URL = harness.url;
	await harness.applyMigrations(ALL_MIGRATIONS);
	testDb = harness.db;
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`truncate account, document, person, property, loan cascade`;
});

/** Far enough out to sit inside every window the briefing and calendar watch. */
const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const different = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

async function seedLeaseDocument(expiresOn: string, targetId: string): Promise<string> {
	const id = uuidv7();
	await testDb.insert(document).values({
		id,
		name: 'Renting contract · Karlín',
		shelfId: await shelfIdByKey('tenancy', testDb),
		type: 'contract',
		addedOn: '2026-01-01',
		expiresOn,
		expiryVerb: 'expires'
	});
	await testDb.insert(documentLink).values({ documentId: id, targetId });
	return id;
}

async function seedTenancy(endsOn: string): Promise<{ tenancyId: string; propertyId: string }> {
	const propertyId = uuidv7();
	await testDb.insert(property).values({ id: propertyId, name: 'Flat Karlín', kind: 'rented' });
	const tenancyId = uuidv7();
	await testDb.insert(tenancy).values({
		id: tenancyId,
		propertyId,
		tenantName: 'Martin Dvořák',
		startsOn: '2025-06-01',
		endsOn
	});
	return { tenancyId, propertyId };
}

async function seedLoanWithCurrentFixation(
	currentFixationEndsOn: string
): Promise<{ loanId: string }> {
	const loanId = uuidv7();
	await testDb.insert(loan).values({
		id: loanId,
		name: 'Mortgage ČS',
		regime: 'fixed_period',
		principalMinor: 9_900_000n,
		owedMinor: 9_270_000n
	});
	// A past, already-superseded period, so the "current" one is not simply the
	// only row in the table.
	await testDb.insert(loanFixationPeriod).values([
		{
			id: uuidv7(),
			loanId,
			startsOn: '2020-01-01',
			endsOn: '2023-01-01',
			annualRatePct: '3.10',
			paymentMinor: 500_000n
		},
		{
			id: uuidv7(),
			loanId,
			startsOn: '2023-01-01',
			endsOn: currentFixationEndsOn,
			annualRatePct: '4.44',
			paymentMinor: 5_445_600n
		}
	]);
	return { loanId };
}

async function seedRefixLetter(expiresOn: string, loanId: string): Promise<string> {
	const id = uuidv7();
	await testDb.insert(document).values({
		id,
		name: 'Mortgage re-fixation letter',
		shelfId: await shelfIdByKey('finance', testDb),
		type: 'contract',
		addedOn: '2026-01-01',
		expiresOn,
		expiryVerb: 'expires'
	});
	await testDb.insert(documentLink).values({ documentId: id, targetId: loanId });
	return id;
}

describe('a lease document dated the same as its tenancy', () => {
	it('gives the briefing one lease item, not two', async () => {
		const { tenancyId } = await seedTenancy(soon);
		await seedLeaseDocument(soon, tenancyId);

		const { items } = await buildBriefing(null);
		const leaseItems = items.filter((i) => i.kind === 'Tenancy' || i.kind === 'Document');
		expect(leaseItems).toHaveLength(1);
		expect(leaseItems[0].kind).toBe('Tenancy');
	});

	it('gives the calendar one event, not two', async () => {
		const { tenancyId } = await seedTenancy(soon);
		await seedLeaseDocument(soon, tenancyId);

		const events = await generateEvents('2020-01-01', '2099-01-01', testDb);
		const onDate = events.filter((e) => e.date === soon);
		expect(onDate).toHaveLength(1);
		expect(onDate[0].binding?.table).toBe('tenancy');
	});
});

describe('a lease document dated differently from its tenancy', () => {
	it('gives the briefing both items', async () => {
		const { tenancyId } = await seedTenancy(soon);
		await seedLeaseDocument(different, tenancyId);

		const { items } = await buildBriefing(null);
		const leaseItems = items.filter((i) => i.kind === 'Tenancy' || i.kind === 'Document');
		expect(leaseItems).toHaveLength(2);
	});

	it('gives the calendar both events', async () => {
		const { tenancyId } = await seedTenancy(soon);
		await seedLeaseDocument(different, tenancyId);

		const events = await generateEvents('2020-01-01', '2099-01-01', testDb);
		expect(events.some((e) => e.date === soon && e.binding?.table === 'tenancy')).toBe(true);
		expect(events.some((e) => e.date === different && e.binding?.table === 'document')).toBe(true);
	});
});

describe('a re-fixation letter dated the same as the loan’s current fixation end', () => {
	it('gives the briefing one mortgage item, not two', async () => {
		const { loanId } = await seedLoanWithCurrentFixation(soon);
		await seedRefixLetter(soon, loanId);

		const { items } = await buildBriefing(null);
		const mortgageItems = items.filter((i) => i.kind === 'Mortgage' || i.kind === 'Document');
		expect(mortgageItems).toHaveLength(1);
		expect(mortgageItems[0].kind).toBe('Mortgage');
	});

	it('gives the calendar one event, not two', async () => {
		const { loanId } = await seedLoanWithCurrentFixation(soon);
		await seedRefixLetter(soon, loanId);

		const events = await generateEvents('2020-01-01', '2099-01-01', testDb);
		const onDate = events.filter((e) => e.date === soon);
		expect(onDate).toHaveLength(1);
		expect(onDate[0].binding?.table).toBe('loanFixationPeriod');
	});
});

describe('a re-fixation letter dated differently from the loan’s current fixation end', () => {
	it('gives the briefing both items', async () => {
		const { loanId } = await seedLoanWithCurrentFixation(soon);
		await seedRefixLetter(different, loanId);

		const { items } = await buildBriefing(null);
		const mortgageItems = items.filter((i) => i.kind === 'Mortgage' || i.kind === 'Document');
		expect(mortgageItems).toHaveLength(2);
	});

	it('gives the calendar both events', async () => {
		const { loanId } = await seedLoanWithCurrentFixation(soon);
		await seedRefixLetter(different, loanId);

		const events = await generateEvents('2020-01-01', '2099-01-01', testDb);
		expect(events.some((e) => e.date === soon && e.binding?.table === 'loanFixationPeriod')).toBe(
			true
		);
		expect(events.some((e) => e.date === different && e.binding?.table === 'document')).toBe(true);
	});
});
