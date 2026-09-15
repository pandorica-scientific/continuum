// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Who may record equity for whom: a member their own, an administrator anybody's.
 *
 * The rule is the payslip rule. The person a grant is for is stated in the form
 * for a new one and read from the row for an existing grant or tranche, and in
 * both cases the signed-in person has to be allowed to act for them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { rowId } from '../row-id';
import { equityGrant, equityTranche, securityPrice } from '$lib/server/db/schema';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makePerson } from './fixtures';

vi.mock('$env/dynamic/private', () => ({
	env: new Proxy({} as Record<string, string | undefined>, {
		get: (_target, key: string) => process.env[key]
	})
}));

let harness: Harness;
let testDb: TestDb;
const ADMIN = rowId('person-admin');
const PETRA = rowId('person-petra');
const ROBERT = rowId('person-robert');
let previousUrl: string | undefined;

const asPerson = (id: string, role: 'admin' | 'member') => ({
	person: { id, name: 'Someone', initials: 'S', role, theme: null }
});

beforeAll(async () => {
	harness = await startPostgres('equity-grant-guard');
	previousUrl = process.env.DATABASE_URL;
	process.env.DATABASE_URL = harness.url;
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
	if (previousUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = previousUrl;
});

beforeEach(async () => {
	await harness.sql`truncate person, organisation, equity_grant, security_price cascade`;
	await makePerson(testDb, { id: ADMIN, name: 'Admin', initials: 'A', role: 'admin' });
	await makePerson(testDb, { id: PETRA, name: 'Petra', initials: 'P', role: 'member' });
	await makePerson(testDb, { id: ROBERT, name: 'Robert', initials: 'R', role: 'member' });
});

type ActionResult = { status?: number; data?: { message?: string }; ok?: boolean };

async function post(
	name: 'addGrant' | 'editSchedule' | 'recordSettlement' | 'recordSale' | 'forfeitGrant',
	fields: Record<string, string>,
	locals: ReturnType<typeof asPerson>
): Promise<ActionResult> {
	const { actions } = await import('../../src/routes/(app)/salary/+page.server');
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	const request = new Request(`http://localhost/salary?/${name}`, { method: 'POST', body: form });
	return (await (actions[name] as unknown as (event: unknown) => Promise<unknown>)({
		request,
		locals
	})) as ActionResult;
}

const EVEN_GRANT = {
	personId: PETRA,
	ticker: 'acme.us',
	currency: 'USD',
	grantedOn: '2025-03-01',
	totalUnits: '400',
	mode: 'even',
	firstVestOn: '2026-03-01',
	count: '4',
	interval: 'yearly'
};

const grants = () => testDb.select().from(equityGrant);
const tranches = (grantId: string) =>
	testDb
		.select()
		.from(equityTranche)
		.where(eq(equityTranche.grantId, grantId))
		.orderBy(equityTranche.vestsOn);

describe('a member and somebody else’s equity', () => {
	it('cannot add a grant for them', async () => {
		const outcome = await post('addGrant', EVEN_GRANT, asPerson(ROBERT, 'member'));
		expect(outcome.status).toBe(403);
		expect(outcome.data?.message).toBe('You can only record your own equity.');
		expect(await grants()).toHaveLength(0);
	});
	it('cannot settle their tranche', async () => {
		await post('addGrant', EVEN_GRANT, asPerson(PETRA, 'member'));
		const [g] = await grants();
		const [t] = await tranches(g.id);
		const outcome = await post(
			'recordSettlement',
			{ trancheId: t.id, settledOn: '2026-03-01', deliveredUnits: '62', withheldUnits: '38' },
			asPerson(ROBERT, 'member')
		);
		expect(outcome.status).toBe(403);
		expect((await tranches(g.id))[0].settledOn).toBeNull();
	});
});

describe('a member and their own equity', () => {
	it('adds a grant, expanding the schedule, and uppercases the ticker', async () => {
		const outcome = await post('addGrant', EVEN_GRANT, asPerson(PETRA, 'member'));
		expect(outcome.status).toBeUndefined();
		const [g] = await grants();
		expect(g.ticker).toBe('ACME.US');
		const ts = await tranches(g.id);
		expect(ts.map((t) => [t.vestsOn, Number(t.units)])).toEqual([
			['2026-03-01', 100],
			['2027-03-01', 100],
			['2028-03-01', 100],
			['2029-03-01', 100]
		]);
	});
	it('records a settlement with the payslip flag, and a later sale within what is held', async () => {
		await post('addGrant', EVEN_GRANT, asPerson(PETRA, 'member'));
		const [g] = await grants();
		const [t] = await tranches(g.id);
		await post(
			'recordSettlement',
			{
				trancheId: t.id,
				settledOn: '2026-03-01',
				deliveredUnits: '62',
				withheldUnits: '38',
				onPayslip: 'on'
			},
			asPerson(PETRA, 'member')
		);
		let [settled] = await tranches(g.id);
		expect(settled.onPayslip).toBe(true);
		expect(Number(settled.deliveredUnits)).toBe(62);
		const tooMany = await post(
			'recordSale',
			{ trancheId: t.id, soldUnits: '70' },
			asPerson(PETRA, 'member')
		);
		expect(tooMany.status).toBe(400);
		await post('recordSale', { trancheId: t.id, soldUnits: '12' }, asPerson(PETRA, 'member'));
		[settled] = await tranches(g.id);
		expect(Number(settled.soldUnits)).toBe(12);
	});
	it('replaces the unsettled part of a schedule and keeps settled tranches', async () => {
		await post('addGrant', EVEN_GRANT, asPerson(PETRA, 'member'));
		const [g] = await grants();
		const [first] = await tranches(g.id);
		await post(
			'recordSettlement',
			{ trancheId: first.id, settledOn: '2026-03-01', deliveredUnits: '100', withheldUnits: '0' },
			asPerson(PETRA, 'member')
		);
		await post(
			'editSchedule',
			{
				grantId: g.id,
				totalUnits: '400',
				mode: 'even',
				firstVestOn: '2027-03-01',
				count: '2',
				interval: 'yearly'
			},
			asPerson(PETRA, 'member')
		);
		const ts = await tranches(g.id);
		expect(ts).toHaveLength(3);
		expect(ts[0].settledOn).toBe('2026-03-01');
		expect(ts.slice(1).map((t) => Number(t.units))).toEqual([150, 150]);
	});
	it('forfeits every pending tranche and leaves vested ones', async () => {
		await post('addGrant', EVEN_GRANT, asPerson(PETRA, 'member'));
		const [g] = await grants();
		const outcome = await post(
			'forfeitGrant',
			{ grantId: g.id, forfeitedOn: '2026-08-01' },
			asPerson(ADMIN, 'admin')
		);
		expect(outcome.status).toBeUndefined();
		const ts = await tranches(g.id);
		expect(ts.filter((t) => t.forfeitedOn !== null).map((t) => t.vestsOn)).toEqual([
			'2027-03-01',
			'2028-03-01',
			'2029-03-01'
		]);
	});
});

describe('a manual price', () => {
	it('outranks a fetched close for the same day', async () => {
		await testDb.insert(securityPrice).values({
			ticker: 'ACME.US',
			day: '2026-09-12',
			closeMinor: 14000n,
			currency: 'USD',
			source: 'manual'
		});
		const { refreshPrices } = await import('$lib/server/prices');
		await post('addGrant', EVEN_GRANT, asPerson(PETRA, 'member'));
		// 1_789_243_200 is 2026-09-12 20:00 UTC.
		const fetchFn = (async () =>
			new Response(
				JSON.stringify({
					chart: {
						result: [
							{
								meta: {
									currency: 'USD',
									regularMarketPrice: 142.3,
									regularMarketTime: 1_789_243_200
								},
								timestamp: [1_789_243_200],
								indicators: { quote: [{ close: [142.3] }] }
							}
						]
					}
				})
			)) as unknown as typeof fetch;
		const result = await refreshPrices(fetchFn, testDb);
		expect(result).toEqual({ fetched: 1, skipped: [] });
		const rows = await testDb.select().from(securityPrice);
		expect(rows).toHaveLength(1);
		expect(rows[0].closeMinor).toBe(14000n);
	});
});
