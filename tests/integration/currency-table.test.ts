import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshCurrencies } from '$lib/server/db/currency-refresh';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

/**
 * The `currency` table exists for integrity PostgreSQL can enforce, not as a
 * source of truth about currencies — `$lib/money` remains that, and it reads
 * CLDR. So the table is MATERIALISED from CLDR at boot rather than seeded by
 * hand: a hand-written list would be a second answer free to drift from the
 * first, and the two genuinely disagree about real currencies.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('currency-table', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

describe('the currency table', () => {
	it('is materialised from the runtime, not hand-seeded', async () => {
		await refreshCurrencies(harness.db);
		const [{ n }] = await harness.sql<{ n: number }[]>`select count(*)::int as n from currency`;
		// CLDR lists about 160 codes. The assertion is that this is not a
		// hand-written handful of the currencies one household happens to hold.
		expect(n).toBeGreaterThan(100);
	});

	it('carries the exponent money.ts uses, which is CLDR and not ISO 4217', async () => {
		await refreshCurrencies(harness.db);
		const rows = await harness.sql<{ code: string; exponent: number }[]>`
			select code, exponent from currency where code in ('CZK', 'JPY', 'HUF', 'KWD')`;
		const byCode = Object.fromEntries(rows.map((r) => [r.code, r.exponent]));
		expect(byCode.CZK).toBe(2);
		expect(byCode.JPY).toBe(0);
		// ISO 4217 gives HUF two decimal places; CLDR gives zero, and CLDR is how
		// the currency is actually written. This assertion is the whole reason the
		// table is derived rather than seeded — a hand-written ISO list would put a
		// 2 here and disagree with `minorDigits`, which is the defect the exponent
		// column exists to prevent.
		expect(byCode.HUF).toBe(0);
		expect(byCode.KWD).toBe(3);
	});

	it('holds an exponent every currency column can actually be scaled by', async () => {
		await refreshCurrencies(harness.db);
		// CLDR lists three exponents and no more: 0 (33 codes), 2 (123) and 3 (the
		// six Gulf and North African dinars). ISO 4217 defines a fourth for CLF and
		// UYW, which CLDR does not list at all — so `minorDigits` never returns 4
		// and nothing stored here needs to handle it. The bound is asserted rather
		// than the exact set, so a runtime that starts listing CLF does not fail
		// this suite for being more complete than the one it was written against.
		const [{ lo, hi }] = await harness.sql<{ lo: number; hi: number }[]>`
			select min(exponent)::int as lo, max(exponent)::int as hi from currency`;
		expect(lo).toBe(0);
		expect(hi).toBeGreaterThanOrEqual(3);
		expect(hi).toBeLessThanOrEqual(4);
	});

	it('covers every currency the CNB fixing quotes', async () => {
		await refreshCurrencies(harness.db);
		// Including XDR, which is the IMF's unit of account rather than a national
		// currency, and is quoted in the daily fixing all the same.
		const quoted = ['EUR', 'USD', 'GBP', 'PLN', 'HUF', 'JPY', 'ISK', 'XDR', 'TRY'];
		const rows = await harness.sql<{ code: string }[]>`
			select code from currency where code in ${harness.sql(quoted)}`;
		expect(rows.map((r) => r.code).sort()).toEqual([...quoted].sort());
	});

	it('refuses a currency code no runtime recognises', async () => {
		await refreshCurrencies(harness.db);
		await expect(
			harness.sql`insert into account (id, name, bank, currency)
				values ('acc-bad', 'Bad', 'other', 'SYN')`
		).rejects.toThrow(/foreign key|violates/i);
	});

	it('accepts one it does', async () => {
		await refreshCurrencies(harness.db);
		await harness.sql`insert into account (id, name, bank, currency)
			values ('acc-ok', 'Fine', 'other', 'CZK')`;
		const rows = await harness.sql`select 1 from account where id = 'acc-ok'`;
		expect(rows).toHaveLength(1);
	});

	it('is idempotent, and never deletes a code something might reference', async () => {
		await refreshCurrencies(harness.db);
		// A code CLDR does not list, standing in for one that a future runtime
		// drops. Removing it on refresh would take every row referencing it down.
		await harness.sql`insert into currency (code, exponent, name)
			values ('QQQ', 2, 'Retired') on conflict (code) do nothing`;
		await refreshCurrencies(harness.db);
		const [{ n }] = await harness.sql<{ n: number }[]>`
			select count(*)::int as n from currency where code = 'QQQ'`;
		expect(n).toBe(1);
	});

	it('corrects an exponent that was wrong', async () => {
		await harness.sql`insert into currency (code, exponent, name) values ('JPY', 2, 'stale')
			on conflict (code) do update set exponent = 2, name = 'stale'`;
		await refreshCurrencies(harness.db);
		const [{ exponent }] = await harness.sql<{ exponent: number }[]>`
			select exponent from currency where code = 'JPY'`;
		expect(exponent).toBe(0);
	});
});
