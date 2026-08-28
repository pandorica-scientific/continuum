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
 * ONE at a time, deliberately — and one across every CPU-bound kind, not one
 * per kind. The claim, the lease and the sweep now live in
 * `$lib/server/jobs/dispatcher`, which reading a statement shares with reading
 * a scanned document: on the sort of box this product is self-hosted on, two of
 * those at once starve the web server that is meant to stay responsive.
 *
 * What is left here is the import half: accepting a file, running one, and the
 * list a person watches while they wait.
 */
import { uuidv7 } from 'uuidv7';
import { and, count, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { job } from '$lib/server/db/schema';
import { LEASE_MS, type JobHandler } from '$lib/server/jobs/dispatcher';
import { ingestFile, type IngestResult } from './ingest';

type Handle = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

// The lease belongs to the dispatcher now; re-exported so the import screen and
// its tests keep referring to one name for it.
export { LEASE_MS };

/**
 * How long a finished job stays in the list.
 *
 * Long enough to read what happened to a file you just dropped, short enough
 * that the queue is not a growing pile of settled work nobody will look at
 * again. The record itself is untouched — this governs one list on one screen.
 */
export const SETTLED_MS = 10 * 60 * 1000;

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
 * Read one queued statement. Registered with the CPU dispatcher, which owns the
 * claim, the lease and the sweep.
 */
export const runImportJob: JobHandler = async (claimed, handle) => {
	let result: IngestResult | undefined;
	let failure: string | undefined;
	try {
		const bytes = new Uint8Array(Buffer.from(claimed.blob ?? '', 'base64'));
		result = await ingestFile(
			claimed.filename ?? 'upload',
			bytes,
			claimed.subjectId ?? undefined,
			handle,
			// This is the whole reason the queue exists. Reading a page as an
			// image takes seconds per page, which is unacceptable on a request
			// and perfectly acceptable here — and it is only ever reached when
			// the text layer could not prove itself.
			{ ocr: true }
		);
	} catch (error) {
		// A reader that throws is a defect, not a rejected statement — those come
		// back as a `result` carrying an error.
		failure = error instanceof Error ? error.message : String(error);
	}
	return {
		result: result ?? undefined,
		error: failure,
		// Kept when the file was NOT read: mapping it by hand needs the bytes, and
		// asking someone to upload the same statement again because we could not
		// read it the first time is a poor apology. Cleared once the job is swept.
		keepBlob: (result?.rowsAdded ?? 0) === 0
	};
};

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
			.where(
				and(
					eq(job.kind, 'import'),
					// A settled job stops being news after ten minutes. It leaves the
					// list on its own rather than sitting there until somebody sweeps
					// it, and there is no timer: `finished_at` is already recorded, so
					// the query simply stops asking for old ones. Anything still queued
					// or running is listed however long it has been waiting.
					or(isNull(job.finishedAt), gt(job.finishedAt, new Date(Date.now() - SETTLED_MS)))
				)
			)
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
 * Take a job out of the queue.
 *
 * Queued: it never ran, so removing it is a cancellation and the bytes go with
 * it. Finished or failed: the reading is over and the row is a receipt, so
 * removing it clears the list.
 *
 * Running: refused. The read is happening now, in another worker, and there is
 * no way to stop it from here — deleting the row would leave that worker
 * finishing into nothing and could leave a statement half ingested. Saying so
 * is better than a control that pretends.
 */
export async function dismissJob(
	id: string,
	handle: Handle = db
): Promise<{ ok: true } | { ok: false; message: string }> {
	const [existing] = await handle.select().from(job).where(eq(job.id, id));
	if (!existing) return { ok: true };
	if (existing.kind !== 'import') return { ok: false, message: 'That is not an import job.' };
	if (existing.state === 'running') {
		return {
			ok: false,
			message: 'That file is being read right now — it can go once it finishes.'
		};
	}
	await handle.delete(job).where(eq(job.id, id));
	return { ok: true };
}
