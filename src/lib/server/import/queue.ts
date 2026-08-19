// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
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
import { uuidv7 } from 'uuidv7';
import { and, asc, count, desc, eq, lt, or, sql } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { job } from '$lib/server/db/schema';
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

interface QueuedJob {
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
	const id = uuidv7();
	await handle.insert(job).values({
		id,
		kind: 'import',
		filename,
		blob: Buffer.from(bytes).toString('base64'),
		byteSize: bytes.length,
		subjectId: appliesToAccountId ?? null
	});
	return id;
}

/**
 * Take the oldest job nobody is working on.
 *
 * The advisory lock makes the read-then-claim atomic across processes, which an
 * in-memory guard would not be. It is held only for the claim itself.
 */
async function claimNext(handle: Handle = db): Promise<typeof job.$inferSelect | null> {
	const expiry = new Date(Date.now() - LEASE_MS);
	return await (handle as Db).transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtextextended('continuum:import-queue', 0))`
		);
		const [next] = await tx
			.select()
			.from(job)
			.where(
				and(
					// The table is shared with calendar sync, whose passes are claimed
					// by the calendar engine and must never be handed to this worker.
					eq(job.kind, 'import'),
					or(
						eq(job.state, 'queued'),
						// A worker that died mid-read left this behind.
						and(eq(job.state, 'running'), lt(job.claimedAt, expiry))
					)
				)
			)
			.orderBy(asc(job.queuedAt))
			.limit(1);
		if (!next) return null;
		await tx
			.update(job)
			.set({ state: 'running', claimedAt: new Date() })
			.where(eq(job.id, next.id));
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
let sweep: Promise<number> | null = null;

export function runQueue(handle: Handle = db): Promise<number> {
	// Join the sweep already running rather than starting a second one.
	//
	// The advisory lock makes one CLAIM atomic; it does nothing about two
	// callers, because the second finds the NEXT job still queued and reads it
	// in parallel — which is precisely the burst of CPU-bound readers this
	// module exists to prevent, and there are two independent callers: every
	// upload, and a tick every five minutes. Worse, since the lease is never
	// renewed, a read running longer than LEASE_MS was re-offered to that tick
	// and ingested a second time while the first was still inside it.
	//
	// In-process is the right scope, as it is for backups: one sweep works
	// through the queue serially, so nothing it is holding can be re-claimed.
	sweep ??= drainQueue(handle).finally(() => {
		sweep = null;
	});
	return sweep;
}

async function drainQueue(handle: Handle = db): Promise<number> {
	// Settled work from earlier sweeps, cleared before this one starts.
	await clearFinished(KEEP_FINISHED_MS, handle);
	let done = 0;
	for (;;) {
		const claimed = await claimNext(handle);
		if (!claimed) return done;

		let result: IngestResult | undefined;
		let failure: string | undefined;
		try {
			const bytes = new Uint8Array(Buffer.from(claimed.blob ?? '', 'base64'));
			result = await ingestFile(
				claimed.filename ?? 'upload',
				bytes,
				claimed.subjectId ?? undefined,
				handle as Db,
				// This is the whole reason the queue exists. Reading a page as an
				// image takes seconds per page, which is unacceptable on a request
				// and perfectly acceptable here — and it is only ever reached when
				// the text layer could not prove itself.
				{ ocr: true }
			);
		} catch (error) {
			// A reader that throws is a defect, not a rejected statement — those
			// come back as a `result` carrying an error. Either way the job stops
			// here rather than being retried into the same failure.
			failure = error instanceof Error ? error.message : String(error);
		}

		await handle
			.update(job)
			.set({
				state: failure ? 'failed' : 'done',
				finishedAt: new Date(),
				result: result ?? null,
				error: failure ?? null,
				// Kept when the file was NOT read: mapping it by hand needs the bytes,
				// and asking someone to upload the same statement again because we
				// could not read it the first time is a poor apology. Cleared once
				// the job is swept away.
				blob: (result?.rowsAdded ?? 0) > 0 ? null : claimed.blob
			})
			.where(eq(job.id, claimed.id));
		done++;
	}
}

/** What the queue looks like to someone watching it. */
export async function queueStatus(
	handle: Handle = db
): Promise<{ waiting: number; running: number; recent: QueuedJob[] }> {
	const [[waiting], [running], recent] = await Promise.all([
		handle
			.select({ n: count() })
			.from(job)
			.where(and(eq(job.kind, 'import'), eq(job.state, 'queued'))),
		handle
			.select({ n: count() })
			.from(job)
			.where(and(eq(job.kind, 'import'), eq(job.state, 'running'))),
		// Newest first, so a fresh upload is never pushed off the end by settled
		// work not yet swept up; reversed below into the order the files arrived.
		//
		// Named columns, deliberately. `payload` is the whole uploaded file in
		// base64 and is retained for an hour on any job that could not be read;
		// selecting it here pulled up to twenty files out of the database and threw
		// them away on every poll of a page that polls every 1.5 seconds.
		handle
			.select({
				id: job.id,
				filename: job.filename,
				state: job.state,
				byteSize: job.byteSize,
				queuedAt: job.queuedAt,
				result: job.result,
				error: job.error
			})
			.from(job)
			.where(eq(job.kind, 'import'))
			.orderBy(desc(job.queuedAt))
			.limit(20)
	]);
	return {
		waiting: waiting?.n ?? 0,
		running: running?.n ?? 0,
		recent: recent.reverse().map((row) => ({
			id: row.id,
			filename: row.filename ?? 'upload',
			state: row.state,
			byteSize: row.byteSize,
			queuedAt: row.queuedAt,
			result: (row.result as IngestResult | null) ?? null,
			error: row.error
		}))
	};
}

/**
 * The bytes of a job that has not been swept away yet.
 *
 * A file that could not be read is still in the queue with its payload intact,
 * which is what makes mapping it possible without asking for the upload again —
 * the person has already handed it over once, and being asked twice because we
 * could not read it the first time is a poor apology.
 */
export async function jobBytes(
	id: string,
	handle: Handle = db
): Promise<{ filename: string; bytes: Uint8Array; accountId?: string } | null> {
	const [row] = await handle
		.select()
		.from(job)
		.where(and(eq(job.id, id), eq(job.kind, 'import')));
	if (!row?.blob) return null;
	return {
		filename: row.filename ?? 'upload',
		bytes: new Uint8Array(Buffer.from(row.blob, 'base64')),
		accountId: row.subjectId ?? undefined
	};
}

/**
 * Forget finished jobs once their outcome has had time to be seen.
 *
 * The queue is a view of work in flight, not a history — `import_file` is the
 * record of what was imported. Left alone this table would grow with every
 * upload forever, and the page's list of recent files would fill with months of
 * settled work.
 */
const KEEP_FINISHED_MS = 60 * 60 * 1000;

async function clearFinished(olderThanMs = KEEP_FINISHED_MS, handle: Handle = db): Promise<number> {
	const removed = await handle
		.delete(job)
		.where(
			and(
				// Only this module's own kind: a finished calendar pass is swept by the
				// calendar engine, on its own schedule.
				eq(job.kind, 'import'),
				or(eq(job.state, 'done'), eq(job.state, 'failed')),
				lt(job.finishedAt, new Date(Date.now() - olderThanMs))
			)
		)
		.returning({ id: job.id });
	return removed.length;
}
