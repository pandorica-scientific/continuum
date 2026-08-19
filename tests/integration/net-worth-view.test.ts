import { rowId } from '../row-id';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeNetWorth } from '$lib/server/networth';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

/**
 * Every valued thing in one place, with the liabilities-are-negative rule
 * applied once in the view rather than in each caller that has to remember it.
 *
 * The point of the view is not tidiness: it is that adding an asset type is one
 * table plus one UNION branch, and net worth picks it up without anyone editing
 * TypeScript. The last test here is that promise, tested rather than asserted.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('net-worth-view', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

describe('net_worth_component', () => {
	it('counts an asset positive and a loan negative', async () => {
		await harness.sql`insert into property (id, name, kind, currency, value_minor, valued_on)
			values (${rowId('nw-flat')}, 'Flat', 'lived', 'CZK', 500000, '2026-08-01')`;
		await harness.sql`insert into loan (id, name, currency, principal_minor, owed_minor, owed_on)
			values (${rowId('nw-mortgage')}, 'Mortgage', 'CZK', 300000, 200000, '2026-08-01')`;
		await harness.sql`insert into account (id, name, bank, kind, currency, balance_minor, balance_on)
			values (${rowId('nw-current')}, 'Current', 'fio', 'current', 'CZK', 50000, '2026-08-01')`;
		await harness.sql`insert into holding (id, ticker, name, units, value_minor, currency, valued_at)
			values (${rowId('nw-etf')}, 'VWCE', 'World ETF', 1, 10000, 'CZK', '2026-08-01T00:00:00Z')`;

		const [{ total }] = await harness.sql<{ total: string }[]>`
			select coalesce(sum(value_minor), 0)::text as total from net_worth_component`;
		// 500000 + 50000 + 10000 assets − 200000 owed. The sign lives in the view.
		expect(total).toBe('360000');
	});

	it('exposes one row per valued thing, labelled by kind and by its own kind', async () => {
		const rows = await harness.sql<{ kind: string; subkind: string }[]>`
			select kind, subkind from net_worth_component order by kind`;
		expect(rows).toEqual([
			{ kind: 'account', subkind: 'current' },
			{ kind: 'holding', subkind: 'STOCK' },
			{ kind: 'loan', subkind: 'mortgage' },
			{ kind: 'property', subkind: 'lived' }
		]);
	});
});

describe('computeNetWorth over the view', () => {
	it('leaves the broker cash to the portfolio report rather than counting it twice', async () => {
		await harness.sql`insert into account (id, name, bank, kind, currency, balance_minor, balance_on)
			values (${rowId('nw-broker')}, 'Broker', 'other', 'brokerage', 'CZK', 70000, '2026-08-01')`;
		await harness.sql`insert into portfolio_snapshot (day, value_minor, currency)
			values ('2026-08-01', 90000, 'CZK')`;

		const nw = await computeNetWorth(harness.db);
		// Cash is the current account alone; the brokerage balance and the
		// holding row are both the broker report, which arrives as its own group.
		expect(nw.groups.find((g) => g.key === 'cash')?.assetMinor).toBe(50000n);
		expect(nw.groups.find((g) => g.key === 'investments')?.assetMinor).toBe(90000n);
		expect(nw.totalMinor).toBe(500000n + 50000n + 90000n - 200000n);
	});

	it('picks up an asset type that did not exist when the code was written', async () => {
		// The whole promise of the view: a new table, one UNION branch, and net
		// worth counts it. No TypeScript is edited between the two assertions.
		const before = await computeNetWorth(harness.db);

		await harness.sql.unsafe(`
			create table vehicle (
				id uuid primary key,
				name text not null,
				currency text not null references currency(code),
				value_minor bigint not null,
				valued_on date,
				owner_person_id uuid references person(id)
			);
			create or replace view net_worth_component as
				select id, 'property'::text as kind, kind::text as subkind, owner_person_id,
				       currency, value_minor, valued_on from property
				union all
				select id, 'account', kind::text, owner_person_id,
				       currency, balance_minor, balance_on from account
				union all
				select id, 'loan', kind::text, owner_person_id,
				       currency, -owed_minor, owed_on from loan
				union all
				select id, 'holding', category, null,
				       currency, value_minor, valued_at::date from holding
				union all
				select id, 'vehicle', 'car', owner_person_id,
				       currency, value_minor, valued_on from vehicle;
		`);
		await harness.sql`insert into vehicle (id, name, currency, value_minor, valued_on)
			values (${rowId('nw-car')}, 'Škoda', 'CZK', 30000, '2026-08-01')`;

		const after = await computeNetWorth(harness.db);
		expect(after.totalMinor - before.totalMinor).toBe(30000n);
	});
});
