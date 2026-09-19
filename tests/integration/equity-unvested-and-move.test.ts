// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Two halves of the same question: what a grant is worth before it vests, and
 * what happens to it once the shares reach a broker the household already
 * tracks.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rowId } from '../row-id';
import { grantsWithTranches, recordMove, recordSale } from '$lib/server/equity';
import { equityNowValues, vestValues } from '$lib/server/salary';
import { grantSummary } from '$lib/equity';
import { ALL_MIGRATIONS, startPostgres, type Harness, type TestDb } from './harness';
import { makePerson } from './fixtures';

let harness: Harness;
let testDb: TestDb;
const ROBERT = rowId('mtv-person');
const GRANT = rowId('mtv-grant');
const VESTED = rowId('mtv-t-vested');
const PENDING = rowId('mtv-t-pending');
const TODAY = '2026-09-17';

// Face value: the FX table is exercised elsewhere and 1:1 keeps these readable.
const same = (amount: bigint) => amount;

beforeAll(async () => {
	harness = await startPostgres('equity-unvested-move', { max: 1 });
	testDb = harness.db;
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from equity_grant`;
	await harness.sql`delete from security_price`;
	await harness.sql`delete from person`;
	await makePerson(testDb, { id: ROBERT, name: 'Robert', initials: 'R', role: 'admin' });
	await harness.sql`insert into equity_grant (id, person_id, ticker, currency, granted_on, total_units)
		values (${GRANT}, ${ROBERT}, 'MRK.US', 'USD', '2026-05-05', 62)`;
	// One vested and settled, one still to come.
	await harness.sql`insert into equity_tranche (id, grant_id, vests_on, units, settled_on, delivered_units, withheld_units)
		values (${VESTED}, ${GRANT}, '2026-06-01', 20, '2026-06-01', 20, 0)`;
	await harness.sql`insert into equity_tranche (id, grant_id, vests_on, units)
		values (${PENDING}, ${GRANT}, '2027-05-05', 42)`;
});

describe('equityNowValues', () => {
	it('values what is still to come at the latest close, and never as income', async () => {
		await harness.sql`insert into security_price (ticker, day, close_minor, currency, source)
			values ('MRK.US', '2026-09-16', 10000, 'USD', 'yahoo')`;

		const [row] = await equityNowValues('USD', same, testDb, TODAY);
		// 42 units still to vest at 100.00, and the 20 already vested and held
		// kept apart from them — one is a holding, the other is not here yet.
		expect(row.pendingUnits).toBe(42);
		expect(row.pendingMinor).toBe(420000n);
		expect(row.heldUnits).toBe(20);
		expect(row.heldMinor).toBe(200000n);
		expect(row.unpricedUnits).toBe(0);
	});

	it('counts units no feed prices rather than valuing them at nothing', async () => {
		// No close at all for the ticker: a zero would read as "worth nothing",
		// which is a different claim from "nobody has quoted it".
		const [row] = await equityNowValues('USD', same, testDb, TODAY);
		expect(row.pendingUnits).toBe(42);
		expect(row.pendingMinor).toBe(0n);
		expect(row.unpricedUnits).toBe(62);
	});

	it('says nothing at all once a grant has neither held nor pending units', async () => {
		await harness.sql`delete from equity_tranche where id = ${PENDING}`;
		await recordMove(VESTED, 20, testDb);
		expect(await equityNowValues('USD', same, testDb, TODAY)).toEqual([]);
	});
});

describe('vestValues counts a grant in the year it was awarded', () => {
	it('puts both halves in the grant year, valued on their own terms', async () => {
		// Granted 2026, vesting 2026 through 2027. The whole award belongs to
		// 2026: that is what 2026 was worth, whatever the schedule says.
		await harness.sql`insert into security_price (ticker, day, close_minor, currency, source)
			values ('MRK.US', '2026-06-01', 20000, 'USD', 'yahoo'),
			       ('MRK.US', '2026-09-16', 10000, 'USD', 'yahoo')`;

		const rows = await vestValues('USD', same, testDb, TODAY);
		expect(rows.every((r) => r.year === 2026)).toBe(true);

		// The vested tranche at ITS OWN day's close (200.00), fixed there;
		// the pending one at the latest close (100.00), which still moves.
		const settled = rows.find((r) => r.vested)!;
		const toCome = rows.find((r) => !r.vested)!;
		expect(settled.valueMinor).toBe(400000n);
		expect(toCome.valueMinor).toBe(420000n);
	});

	it('drops a forfeited tranche from the year entirely', async () => {
		await harness.sql`insert into security_price (ticker, day, close_minor, currency, source)
			values ('MRK.US', '2026-09-16', 10000, 'USD', 'yahoo')`;
		await harness.sql`update equity_tranche set forfeited_on = '2026-08-01' where id = ${PENDING}`;
		const rows = await vestValues('USD', same, testDb, TODAY);
		expect(rows.some((r) => !r.vested)).toBe(false);
	});
});

describe('recordMove', () => {
	it('stops the grant counting units the broker now reports, without calling it a sale', async () => {
		await recordMove(VESTED, 20, testDb);

		const [{ tranches }] = await grantsWithTranches(testDb);
		const moved = tranches.find((t) => t.id === VESTED)!;
		// Still owned — nothing was sold, and the record says so.
		expect(moved.movedUnits).toBe(20);
		expect(moved.soldUnits).toBe(0);
		// But no longer held AS A GRANT: the broker's report values them now, and
		// counting them here too would be the same shares twice.
		expect(grantSummary(tranches, TODAY).heldUnits).toBe(0);
		// It still vested: what was earned in June stays earned.
		expect(grantSummary(tranches, TODAY).vestedUnits).toBe(20);
	});

	it('leaves moved units out of net worth, where the broker report counts them', async () => {
		await harness.sql`insert into security_price (ticker, day, close_minor, currency, source)
			values ('MRK.US', '2026-09-16', 10000, 'USD', 'yahoo')`;
		await recordMove(VESTED, 15, testDb);

		// The view is what `computeNetWorth` reads; it has to agree with
		// `grantSummary` or the sidebar counts the same shares twice.
		const rows = await harness.sql<{ value_minor: string }[]>`
			select value_minor from net_worth_component where kind = 'equity'`;
		expect(rows.map((row) => BigInt(row.value_minor))).toEqual([50000n]);

		await recordMove(VESTED, 5, testDb);
		expect(
			await harness.sql`select id from net_worth_component where kind = 'equity'`
		).toHaveLength(0);
	});

	it('refuses to move more units than the tranche holds', async () => {
		await expect(recordMove(VESTED, 21, testDb)).rejects.toThrow(/Only 20 units/);
	});

	it('will not sell units that already moved to the broker', async () => {
		// They are not there to sell any more; the broker's own record is where
		// that sale belongs.
		await recordMove(VESTED, 15, testDb);
		await expect(recordSale(VESTED, 10, testDb)).rejects.toThrow(/Only 5 units/);
		await recordSale(VESTED, 5, testDb);
	});
});
