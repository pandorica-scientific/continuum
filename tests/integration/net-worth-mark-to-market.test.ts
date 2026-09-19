// SPDX-License-Identifier: AGPL-3.0-or-later
import { rowId } from '../row-id';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { computeNetWorth } from '$lib/server/networth';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

/**
 * Between broker reports, net worth's investments figure should still move
 * with the market — the report's total stays the baseline (it alone carries
 * broker cash and fees), and a per-holding price drift is added on top.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('net-worth-mtm', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

afterEach(async () => {
	await harness.sql`delete from holding`;
	await harness.sql`delete from portfolio_snapshot`;
	await harness.sql`delete from security_price`;
	await harness.sql`delete from currency_rate`;
});

describe('computeNetWorth marks the portfolio to market between reports', () => {
	it('adds price drift since the report on top of the reported total', async () => {
		await harness.sql`insert into holding (id, ticker, name, units, value_minor, currency, valued_at)
			values (${rowId('mtm-h1')}, 'VWCE.DE', 'World ETF', 10, 100000, 'CZK', '2026-08-01T00:00:00Z')`;
		await harness.sql`insert into portfolio_snapshot (day, value_minor, currency)
			values ('2026-08-01', 100000, 'CZK')`;
		// A close fetched the day after the report: price rose from 10000 to
		// 11000 minor per unit, a 10000 minor drift over 10 units.
		await harness.sql`insert into security_price (ticker, day, close_minor, currency, source)
			values ('VWCE.DE', '2026-08-02', 11000, 'CZK', 'yahoo')`;

		const nw = await computeNetWorth(harness.db);
		const group = nw.groups.find((g) => g.key === 'investments');
		expect(group?.assetMinor).toBe(110000n);
		expect(group?.detail).toBe('broker report of 2026-08-01, marked to market');
	});

	it('falls back to the reported total when a holding has no fresher close', async () => {
		await harness.sql`insert into holding (id, ticker, name, units, value_minor, currency, valued_at)
			values (${rowId('mtm-h2')}, 'TSLA.DE', 'Tesla', 5, 50000, 'CZK', '2026-08-01T00:00:00Z')`;
		await harness.sql`insert into portfolio_snapshot (day, value_minor, currency)
			values ('2026-08-01', 50000, 'CZK')`;

		const nw = await computeNetWorth(harness.db);
		const group = nw.groups.find((g) => g.key === 'investments');
		expect(group?.assetMinor).toBe(50000n);
		expect(group?.detail).toBe('broker report of 2026-08-01');
	});

	it("marks to a close from the report's own day, rather than waiting for tomorrow", async () => {
		// The day a report is uploaded is the day this matters most: the report
		// is generated at some moment and the day's close is fetched after it.
		// Requiring a strictly later close left the figure frozen until the next
		// day, which read as "nothing moved" on the day it moved.
		await harness.sql`insert into holding (id, ticker, name, units, value_minor, currency, valued_at)
			values (${rowId('mtm-h3')}, 'VWCE.DE', 'World ETF', 10, 100000, 'CZK', '2026-08-01T00:00:00Z')`;
		await harness.sql`insert into portfolio_snapshot (day, value_minor, currency)
			values ('2026-08-01', 100000, 'CZK')`;
		await harness.sql`insert into security_price (ticker, day, close_minor, currency, source)
			values ('VWCE.DE', '2026-08-01', 12000, 'CZK', 'yahoo')`;

		const nw = await computeNetWorth(harness.db);
		const group = nw.groups.find((g) => g.key === 'investments');
		expect(group?.assetMinor).toBe(120000n);
		expect(group?.detail).toBe('broker report of 2026-08-01, marked to market');
	});

	it('ignores a close from BEFORE the report, which the report already knew', async () => {
		await harness.sql`insert into holding (id, ticker, name, units, value_minor, currency, valued_at)
			values (${rowId('mtm-h7')}, 'VWCE.DE', 'World ETF', 10, 100000, 'CZK', '2026-08-01T00:00:00Z')`;
		await harness.sql`insert into portfolio_snapshot (day, value_minor, currency)
			values ('2026-08-01', 100000, 'CZK')`;
		await harness.sql`insert into security_price (ticker, day, close_minor, currency, source)
			values ('VWCE.DE', '2026-07-30', 12000, 'CZK', 'yahoo')`;

		const nw = await computeNetWorth(harness.db);
		const group = nw.groups.find((g) => g.key === 'investments');
		expect(group?.assetMinor).toBe(100000n);
		expect(group?.detail).toBe('broker report of 2026-08-01');
	});

	it('leaves one unpriced holding out of the whole drift, not just its own share', async () => {
		await harness.sql`insert into holding (id, ticker, name, units, value_minor, currency, valued_at)
			values (${rowId('mtm-h4')}, 'VWCE.DE', 'World ETF', 10, 100000, 'CZK', '2026-08-01T00:00:00Z'),
			       (${rowId('mtm-h5')}, 'TSLA.DE', 'Tesla', 5, 50000, 'CZK', '2026-08-01T00:00:00Z')`;
		await harness.sql`insert into portfolio_snapshot (day, value_minor, currency)
			values ('2026-08-01', 150000, 'CZK')`;
		await harness.sql`insert into security_price (ticker, day, close_minor, currency, source)
			values ('VWCE.DE', '2026-08-02', 11000, 'CZK', 'yahoo')`;

		const nw = await computeNetWorth(harness.db);
		const group = nw.groups.find((g) => g.key === 'investments');
		expect(group?.assetMinor).toBe(150000n);
		expect(group?.detail).toBe('broker report of 2026-08-01');
	});

	it("converts the close in the feed's own currency, not the holding's", async () => {
		// The real bug this guards: a broker ticker held (and reported) in EUR
		// can still be quoted by a feed in USD (Yahoo prices US-listed stock in
		// USD regardless of which account currency the broker report used).
		await harness.sql`insert into currency_rate (code, day, rate) values ('EUR', '2026-08-01', 25), ('USD', '2026-08-01', 20)`;
		await harness.sql`insert into holding (id, ticker, name, units, value_minor, currency, valued_at)
			values (${rowId('mtm-h6')}, 'RKLB.US', 'Rocket Lab', 10, 100000, 'EUR', '2026-08-01T00:00:00Z')`;
		await harness.sql`insert into portfolio_snapshot (day, value_minor, currency)
			values ('2026-08-01', 100000, 'EUR')`;
		// 12.50 USD/unit × 10 units = 125.00 USD, converted at 20 CZK/USD.
		await harness.sql`insert into security_price (ticker, day, close_minor, currency, source)
			values ('RKLB.US', '2026-08-02', 1250, 'USD', 'yahoo')`;

		const nw = await computeNetWorth(harness.db);
		const group = nw.groups.find((g) => g.key === 'investments');
		expect(group?.assetMinor).toBe(250000n);
		expect(group?.detail).toBe('broker report of 2026-08-01, marked to market');
	});
});
