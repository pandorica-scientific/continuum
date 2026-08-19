import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

/**
 * Constraints and types the schema was missing, closed while there are no
 * deployments to migrate.
 *
 * Each of these was nullable, untyped or unreferenced for a reason that expired:
 * a column added after its table existed and never made required, a foreign key
 * nobody got round to, a date kept as text because the first writer had a string
 * in hand.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('integrity-gaps', { max: 1 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

describe('broker_operation.position_id', () => {
	it('has to name a position that exists', async () => {
		// It referenced nothing at all: an operation could point at a position id
		// that had never been imported, and the reconstructed value curve would
		// silently lose that cash movement.
		await expect(
			harness.sql`insert into broker_operation
				(id, type, happened_at, amount_minor, currency, position_id)
				values ('op-1', 'Dividend', now(), 100, 'CZK', 'no-such-position')`
		).rejects.toThrow(/foreign key|violates/i);
	});

	it('may still be null, because most operations belong to no position', async () => {
		await harness.sql`insert into broker_operation
			(id, type, happened_at, amount_minor, currency)
			values ('op-2', 'Deposit', now(), 100, 'CZK')`;
		const rows = await harness.sql`select 1 from broker_operation where id = 'op-2'`;
		expect(rows).toHaveLength(1);
	});
});

describe('import_file provenance', () => {
	it('records how it was read, or refuses the row', async () => {
		const required = await harness.sql<{ column_name: string; is_nullable: string }[]>`
			select column_name, is_nullable from information_schema.columns
			where table_name = 'import_file'
			  and column_name in ('currency', 'proof_class', 'source_method')
			order by column_name`;
		// All three were added after the table existed and left nullable, so a
		// statement could be filed with no record of what read it or how strongly it
		// was proven — which is the one thing the provenance columns exist for.
		expect(required.map((r) => `${r.column_name}:${r.is_nullable}`)).toEqual([
			'currency:NO',
			'proof_class:NO',
			'source_method:NO'
		]);
	});
});

describe('document.period_on', () => {
	it('is a date, not a YYYY-MM string', async () => {
		const [{ data_type }] = await harness.sql<{ data_type: string }[]>`
			select data_type from information_schema.columns
			where table_name = 'document' and column_name = 'period_on'`;
		expect(data_type).toBe('date');
	});

	it('accepts the first of a month', async () => {
		await harness.sql`insert into document (id, name, shelf, added_on, period_on)
			values ('doc-1', 'March payslip', 'payslips', '2026-04-01', '2026-03-01')`;
		const [row] = await harness.sql<{ period_on: string }[]>`
			select to_char(period_on, 'YYYY-MM-DD') as period_on from document where id = 'doc-1'`;
		expect(row.period_on).toBe('2026-03-01');
	});

	it('refuses a day that is not the first', async () => {
		// The column means "the month this document covers". A mid-month date is
		// either a different fact or a mistake, and the old text column could hold
		// anything at all — including a value the FX join's regex silently skipped.
		await expect(
			harness.sql`insert into document (id, name, shelf, added_on, period_on)
				values ('doc-2', 'Odd', 'payslips', '2026-04-01', '2026-03-17')`
		).rejects.toThrow(/document_period_first_of_month/);
	});

	it('is still optional, because most documents cover no period', async () => {
		await harness.sql`insert into document (id, name, shelf, added_on)
			values ('doc-3', 'Passport', 'identity', '2026-04-01')`;
		const rows = await harness.sql`select 1 from document where id = 'doc-3'`;
		expect(rows).toHaveLength(1);
	});
});

describe('loan.interest_deductible', () => {
	it('is a boolean, which is what it always meant', async () => {
		const [{ data_type }] = await harness.sql<{ data_type: string }[]>`
			select data_type from information_schema.columns
			where table_name = 'loan' and column_name = 'interest_deductible'`;
		expect(data_type).toBe('boolean');
	});

	it('keeps its default of false', async () => {
		await harness.sql`insert into loan (id, name, principal_minor, owed_minor)
			values ('loan-1', 'Mortgage', 1000, 900)`;
		const [row] = await harness.sql<{ interest_deductible: boolean }[]>`
			select interest_deductible from loan where id = 'loan-1'`;
		expect(row.interest_deductible).toBe(false);
	});
});
