// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One CPU slot, shared by every kind of work that would fight for it.
 *
 * Reading a statement and reading a scanned document are the same problem: both
 * are CPU-bound, both run for seconds to minutes, and both are self-hosted on a
 * box — a NAS, a small VPS — whose web server has to stay responsive. Two
 * queues, one per kind, would let an import and an OCR run at the same time,
 * which is exactly the situation a queue exists to prevent. So there is ONE
 * claim across `import` and `extract_text`, under one advisory lock.
 *
 * `calendar_sync` is deliberately absent: it is network-bound and is claimed by
 * the calendar engine on its own schedule.
 *
 * The claim is a LEASE rather than a lock, following `calendar/sync/engine.ts`:
 * the work in the middle runs for seconds and no database lock belongs open
 * across it. A worker that dies mid-job leaves a stale stamp, and the job
 * becomes claimable again instead of being stranded in `running`.
 */
import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import { job } from '$lib/server/db/schema';

/** The kinds that compete for the single CPU slot. */
export const CPU_KINDS = ['import', 'extract_text'] as const;
export type CpuKind = (typeof CPU_KINDS)[number];

export type JobRow = typeof job.$inferSelect;

/** What a handler leaves on the job row when it finishes. */
export interface JobOutcome {
	result?: unknown;
	error?: string;
	/**
	 * Keep the uploaded bytes on the row. An import keeps them when the file
	 * could not be read, so mapping it by hand does not need the upload again.
	 */
	keepBlob?: boolean;
}

export type JobHandler = (claimed: JobRow, handle: Db) => Promise<JobOutcome>;

const handlers = new Map<CpuKind, JobHandler>();

/**
 * Register who runs a kind of job.
 *
 * Registration rather than a switch: the dispatcher must not import the modules
 * it dispatches to, or the import queue and the extraction engine would each
 * pull the other in through it. `$lib/server/jobs` is the composition root that
 * wires both.
 */
export function registerHandler(kind: CpuKind, handler: JobHandler): void {
	handlers.set(kind, handler);
}

/**
 * How long a claim is believed before the job is offered again.
 *
 * Long enough that a slow read is never taken away from a worker still doing
 * it, short enough that a killed process does not leave a file unread until
 * someone notices.
 */
export const LEASE_MS = 10 * 60 * 1000;

/**
 * Forget finished jobs once their outcome has had time to be seen.
 *
 * The queue is a view of work in flight, not a history — `import_file` is the
 * record of what was imported, and `document_text` of what was read.
 */
export const KEEP_FINISHED_MS = 60 * 60 * 1000;

/**
 * Take the oldest job nobody is working on, of either CPU kind.
 *
 * The advisory lock makes the read-then-claim atomic across processes, which an
 * in-memory guard would not be. It is held only for the claim itself.
 */
async function claimNext(handle: Queryable = db): Promise<JobRow | null> {
	const expiry = new Date(Date.now() - LEASE_MS);
	return await (handle as Db).transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('continuum:cpu-queue', 0))`);
		const [next] = await tx
			.select()
			.from(job)
			.where(
				and(
					// One claim across both kinds. Two claims, one per kind, would put
					// two CPU-bound jobs on the box at once.
					inArray(job.kind, [...CPU_KINDS]),
					or(
						eq(job.state, 'queued'),
						// A worker that died mid-job left this behind.
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

export async function clearFinished(
	olderThanMs = KEEP_FINISHED_MS,
	handle: Queryable = db
): Promise<number> {
	const removed = await handle
		.delete(job)
		.where(
			and(
				// Only the CPU kinds: a finished calendar pass is swept by the
				// calendar engine, on its own schedule.
				inArray(job.kind, [...CPU_KINDS]),
				or(eq(job.state, 'done'), eq(job.state, 'failed')),
				lt(job.finishedAt, new Date(Date.now() - olderThanMs))
			)
		)
		.returning({ id: job.id });
	return removed.length;
}

let sweep: Promise<number> | null = null;

/**
 * Work through everything waiting, one job after another.
 *
 * Returns when the queue is empty. Safe to call concurrently: the second caller
 * joins the sweep already running rather than starting a second one.
 *
 * The in-process guard is not redundant with the advisory lock. The lock makes
 * one CLAIM atomic; it does nothing about two CALLERS, because the second finds
 * the NEXT job still queued and runs it in parallel — which is precisely the
 * burst of CPU-bound work this module exists to prevent, and there are two
 * independent callers: every upload, and a tick every five minutes. Worse,
 * since the lease is never renewed, a job running longer than LEASE_MS was
 * re-offered to that tick and run a second time while the first was inside it.
 */
export function runCpuQueue(handle: Queryable = db): Promise<number> {
	sweep ??= drain(handle).finally(() => {
		sweep = null;
	});
	return sweep;
}

async function drain(handle: Queryable = db): Promise<number> {
	// Settled work from earlier sweeps, cleared before this one starts.
	await clearFinished(KEEP_FINISHED_MS, handle);
	let done = 0;
	for (;;) {
		const claimed = await claimNext(handle);
		if (!claimed) return done;

		const handler = handlers.get(claimed.kind as CpuKind);
		let outcome: JobOutcome;
		if (!handler) {
			// A kind nobody registered is a wiring defect, and leaving the job
			// `running` would strand it until the lease expired and it was tried
			// again, for ever. It fails once and says why.
			outcome = { error: `No handler registered for job kind "${claimed.kind}".` };
		} else {
			try {
				outcome = await handler(claimed, handle as Db);
			} catch (error) {
				// A handler that throws is a defect, not a rejected file — a rejection
				// comes back as a `result` carrying an error. Either way the job stops
				// here rather than being retried into the same failure.
				outcome = { error: error instanceof Error ? error.message : String(error) };
			}
		}

		await handle
			.update(job)
			.set({
				state: outcome.error ? 'failed' : 'done',
				finishedAt: new Date(),
				result: outcome.result ?? null,
				error: outcome.error ?? null,
				blob: outcome.keepBlob ? claimed.blob : null
			})
			.where(eq(job.id, claimed.id));
		done++;
	}
}
