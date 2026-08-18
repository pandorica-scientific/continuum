/**
 * Statements are read in the background, one at a time.
 *
 * Reading is not always fast. A 140-movement statement spread over eight pages
 * is recovered from glyph coordinates by two independent assemblers, and every
 * candidate reading is proved before one of them is chosen. None of that
 * belongs on a request someone is waiting behind, and a person dropping six
 * files should see six of them queue rather than one long pause.
 *
 * ONE at a time, deliberately. The work is CPU-bound, and on the sort of box
 * this product is self-hosted on — a NAS, a small VPS — parallel readers would
 * starve the web server that is meant to stay responsive. A queue that keeps
 * the interface alive is the whole point; a queue that races itself is not.
 *
 * The claim is a LEASE rather than a lock, following `calendar/sync/engine.ts`
 * for the same reason: the work in the middle runs for seconds and no database
 * lock belongs open across it. The lease is what lets a job survive a worker
 * that dies mid-read — it becomes claimable again instead of being stranded
 * forever in `running`.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, lt, or, sql } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { importJob } from '$lib/server/db/schema';
import { ingestFile, type IngestResult } from './ingest';

type Handle = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * How long a claim is believed before the job is offered again.
 *
 * Long enough that a slow read is never taken away from a worker still doing
 * it, short enough that a killed process does not leave a file unread until
 * someone notices.
 */
export const LEASE_MS = 10 * 60 * 1000;

export interface QueuedJob {
	id: string;
	filename: string;
	state: string;
	byteSize: number;
	queuedAt: Date;
	result: IngestResult | null;
	error: string | null;
}

/** Accept a file for reading and return immediately. */
export async function enqueue(
	filename: string,
	bytes: Uint8Array,
	appliesToAccountId?: string,
	handle: Handle = db
): Promise<string> {
	const id = randomUUID();
	await handle.insert(importJob).values({
		id,
		filename,
		payload: Buffer.from(bytes).toString('base64'),
		byteSize: bytes.length,
		appliesToAccountId: appliesToAccountId ?? null
	});
	return id;
}

/**
 * Take the oldest job nobody is working on.
 *
 * The advisory lock makes the read-then-claim atomic across processes, which an
 * in-memory guard would not be. It is held only for the claim itself.
 */
async function claimNext(handle: Handle = db): Promise<typeof importJob.$inferSelect | null> {
	const expiry = new Date(Date.now() - LEASE_MS);
	return await (handle as Db).transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended('continuum:import-queue', 0))`
		);
		const [next] = await tx
			.select()
			.from(importJob)
			.where(
				or(
					eq(importJob.state, 'queued'),
					// A worker that died mid-read left this behind.
					and(eq(importJob.state, 'running'), lt(importJob.claimedAt, expiry))
				)
			)
			.orderBy(asc(importJob.queuedAt))
			.limit(1);
		if (!next) return null;
		await tx
			.update(importJob)
			.set({ state: 'running', claimedAt: new Date() })
			.where(eq(importJob.id, next.id));
		return next;
	});
}

/**
 * Read every waiting statement, one after another.
 *
 * Returns when the queue is empty. Safe to call concurrently: the second caller
 * finds nothing to claim and returns, so a burst of uploads does not start a
 * burst of workers.
 */
export async function runQueue(handle: Handle = db): Promise<number> {
	let done = 0;
	for (;;) {
		const job = await claimNext(handle);
		if (!job) return done;

		let result: IngestResult | undefined;
		let failure: string | undefined;
		try {
			const bytes = new Uint8Array(Buffer.from(job.payload ?? '', 'base64'));
			result = await ingestFile(
				job.filename,
				bytes,
				job.appliesToAccountId ?? undefined,
				handle as Db
			);
		} catch (error) {
			// A reader that throws is a defect, not a rejected statement — those
			// come back as a `result` carrying an error. Either way the job stops
			// here rather than being retried into the same failure.
			failure = error instanceof Error ? error.message : String(error);
		}

		await handle
			.update(importJob)
			.set({
				state: failure ? 'failed' : 'done',
				finishedAt: new Date(),
				result: result ?? null,
				error: failure ?? null,
				// The bytes have done their job; `import_file` keeps the original.
				payload: null
			})
			.where(eq(importJob.id, job.id));
		done++;
	}
}

/** What the queue looks like to someone watching it. */
export async function queueStatus(
	handle: Handle = db
): Promise<{ waiting: number; running: number; recent: QueuedJob[] }> {
	const [[waiting], [running], recent] = await Promise.all([
		handle.select({ n: count() }).from(importJob).where(eq(importJob.state, 'queued')),
		handle.select({ n: count() }).from(importJob).where(eq(importJob.state, 'running')),
		handle.select().from(importJob).orderBy(asc(importJob.queuedAt)).limit(50)
	]);
	return {
		waiting: waiting?.n ?? 0,
		running: running?.n ?? 0,
		recent: recent.map((job) => ({
			id: job.id,
			filename: job.filename,
			state: job.state,
			byteSize: job.byteSize,
			queuedAt: job.queuedAt,
			result: (job.result as IngestResult | null) ?? null,
			error: job.error
		}))
	};
}

/** Forget finished jobs once their outcome has been seen. */
export async function clearFinished(handle: Handle = db): Promise<number> {
	const removed = await handle
		.delete(importJob)
		.where(or(eq(importJob.state, 'done'), eq(importJob.state, 'failed')))
		.returning({ id: importJob.id });
	return removed.length;
}
