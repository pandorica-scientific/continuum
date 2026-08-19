import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_MIGRATIONS, startPostgres, type Harness } from './harness';

/**
 * One table for work that is claimed under a lease.
 *
 * `import_job` and `calendar_account.syncing_since` were the same mechanism
 * written twice: take the work, stamp the time, let a stale stamp be taken over
 * so a crashed worker strands nothing. A third integration would have written it
 * a third time.
 *
 * The two kinds keep their own trigger models, which are genuinely different and
 * not worth forcing together — an import is QUEUED and drained by a worker, a
 * calendar pass runs when something asks for it and only needs to know whether
 * another pass holds the account. What they now share is the row, the states,
 * the lease and the attempt count.
 */
let harness: Harness;

beforeAll(async () => {
	harness = await startPostgres('job-queue', { max: 3 });
	await harness.applyMigrations(ALL_MIGRATIONS);
}, 180_000);

afterAll(async () => {
	await harness?.stop();
});

beforeEach(async () => {
	await harness.sql`delete from job`;
});

const claim = (kind: string) => harness.sql`
	update job set state = 'running', claimed_at = now(), attempts = attempts + 1
	where id = (
		select id from job where kind = ${kind} and state = 'queued'
		order by queued_at for update skip locked limit 1
	)
	returning id`;

describe('claiming', () => {
	it('hands one queued job to exactly one of two racing workers', async () => {
		await harness.sql`insert into job (id, kind, state) values ('j1', 'import', 'queued')`;
		const [a, b] = await Promise.all([claim('import'), claim('import')]);
		expect(a.length + b.length).toBe(1);
	});

	it('counts attempts, so a job that keeps dying can be given up on', async () => {
		await harness.sql`insert into job (id, kind, state) values ('j2', 'import', 'queued')`;
		await claim('import');
		await harness.sql`update job set state = 'queued' where id = 'j2'`;
		await claim('import');
		const [{ attempts }] = await harness.sql<{ attempts: number }[]>`
			select attempts from job where id = 'j2'`;
		// The calendar lease had no equivalent: a pass that failed every time was
		// retried for ever with nothing recording that it had.
		expect(attempts).toBe(2);
	});

	it('takes over a lease whose worker died', async () => {
		await harness.sql`insert into job (id, kind, state, claimed_at)
			values ('j3', 'import', 'running', now() - interval '2 hours')`;
		const stale = await harness.sql`
			update job set state = 'running', claimed_at = now(), attempts = attempts + 1
			where kind = 'import' and state = 'running' and claimed_at < now() - interval '10 minutes'
			returning id`;
		expect(stale.map((r) => r.id)).toEqual(['j3']);
	});

	it('leaves a fresh lease alone', async () => {
		await harness.sql`insert into job (id, kind, state, claimed_at)
			values ('j4', 'import', 'running', now())`;
		const taken = await harness.sql`
			update job set claimed_at = now()
			where kind = 'import' and state = 'running' and claimed_at < now() - interval '10 minutes'
			returning id`;
		expect(taken).toHaveLength(0);
	});
});

describe('the shape it has to support', () => {
	it('carries the uploaded bytes for an import, and lets them be cleared', async () => {
		await harness.sql`insert into job (id, kind, state, filename, blob, byte_size)
			values ('j5', 'import', 'queued', 'statement.pdf', 'YmFzZTY0', 8)`;
		await harness.sql`update job set blob = null, state = 'done', finished_at = now()
			where id = 'j5'`;
		const [row] = await harness.sql<{ blob: string | null; byte_size: number }[]>`
			select blob, byte_size from job where id = 'j5'`;
		// The size outlives the bytes: the upload screen still reports what it read
		// after the payload has been cleared.
		expect(row.blob).toBeNull();
		expect(row.byte_size).toBe(8);
	});

	it('names what a job is about, for kinds where that is the work', async () => {
		await harness.sql`insert into calendar_account (id, provider, label, credential)
			values ('cal-1', 'google', 'Mine', 'secret')`;
		await harness.sql`insert into job (id, kind, subject_id, state)
			values ('j6', 'calendar_sync', 'cal-1', 'running')`;
		const [row] = await harness.sql<{ subject_id: string }[]>`
			select subject_id from job where id = 'j6'`;
		expect(row.subject_id).toBe('cal-1');
	});

	it('refuses a kind or a state it does not know', async () => {
		await expect(
			harness.sql`insert into job (id, kind, state) values ('j7', 'telepathy', 'queued')`
		).rejects.toThrow(/job_kind_check/);
		await expect(
			harness.sql`insert into job (id, kind, state) values ('j8', 'import', 'pondering')`
		).rejects.toThrow(/job_state_check/);
	});
});

describe('what it replaces', () => {
	it('has taken over from import_job', async () => {
		const rows = await harness.sql`select tablename from pg_tables
			where schemaname = 'public' and tablename = 'import_job'`;
		expect(rows).toHaveLength(0);
	});

	it('has taken the lease off the calendar account', async () => {
		const rows = await harness.sql`select column_name from information_schema.columns
			where table_name = 'calendar_account' and column_name = 'syncing_since'`;
		expect(rows).toHaveLength(0);
	});
});
