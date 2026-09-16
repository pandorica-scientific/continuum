// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Statements are read in the background, one at a time.
 *
 * Reading is not always fast — recovering a table from glyph coordinates and
 * proving candidate readings does not belong on a request someone is waiting
 * behind.
 *
 * ONE at a time, deliberately, and one across every CPU-bound kind, not one
 * per kind: the claim, lease and sweep live in `$lib/server/jobs/dispatcher`,
 * shared with document extraction, since two of those at once starve the web
 * server on the sort of box this product is self-hosted on.
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
			// This is the whole reason the queue exists: reading a page as an image
			// takes seconds, fine here but not on a request, and is only ever
			// reached when the text layer could not prove itself.
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
		// Kept when the file was NOT read: mapping it by hand needs the bytes.
		// Cleared once the job is swept.
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
		// Named columns, deliberately: `payload` is the whole uploaded file in
		// base64, and selecting it here would pull up to twenty files out of the
		// database on every poll of a page that polls every 1.5 seconds.
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
					// A settled job stops being news after ten minutes: the query
					// simply stops asking for old ones. Anything still queued or
					// running is listed however long it has been waiting.
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
 * which is what makes mapping it possible without asking for the upload again.
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
 * Running: refused — deleting the row would leave that worker finishing into
 * nothing and could leave a statement half ingested.
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
