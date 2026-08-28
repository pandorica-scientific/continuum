// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Getting a document into the CPU queue, and out of it again.
 *
 * Extraction shares one slot with statement imports, so nothing here runs the
 * work — it only says a document is waiting for it. `subjectId` carries which
 * document, the way a calendar pass carries which account.
 *
 * The staleness invariant has two ends and this is one of them: replacing a
 * file CANCELS a queued extraction before enqueueing a new one, so the worker
 * never turns pages of a file nobody has any more. The other end lives in
 * `extractDocumentText`, which refuses to commit a run whose bytes are no
 * longer the document's — cancellation cannot reach a job already running.
 */
import { and, eq, isNotNull, isNull, notInArray, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db, type Queryable } from '$lib/server/db';
import { document, documentText, job } from '$lib/server/db/schema';
import { isExtractable } from './index';

/** Ask for a document's text to be read. Nothing happens until the queue runs. */
export async function enqueueExtraction(
	documentId: string,
	handle: Queryable = db
): Promise<string | null> {
	const [row] = await handle
		.select({ storedName: document.storedName, ext: document.ext })
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	// A metadata-only document has nothing to read, and a format nothing can
	// read must not sit in the queue looking like work.
	if (!row?.storedName || !isExtractable(row.ext)) return null;

	await cancelQueuedExtraction(documentId, handle);
	const id = uuidv7();
	await handle.insert(job).values({ id, kind: 'extract_text', subjectId: documentId });
	return id;
}

/**
 * Drop an extraction that has not started.
 *
 * A job already `running` is left alone: there is no way to stop it from here,
 * and its own commit guard is what stops it writing about the old file.
 */
export async function cancelQueuedExtraction(
	documentId: string,
	handle: Queryable = db
): Promise<number> {
	const removed = await handle
		.delete(job)
		.where(
			and(eq(job.kind, 'extract_text'), eq(job.subjectId, documentId), eq(job.state, 'queued'))
		)
		.returning({ id: job.id });
	return removed.length;
}

/**
 * Queue every document that has a file and no text yet.
 *
 * Run once after the upgrade, and safe to run again: a document already read is
 * skipped, and one already queued is not queued twice.
 */
export async function backfillExtraction(handle: Db = db): Promise<number> {
	const queued = await handle
		.select({ documentId: job.subjectId })
		.from(job)
		.where(and(eq(job.kind, 'extract_text'), isNotNull(job.subjectId)));
	const already = queued.map((row) => row.documentId!).filter(Boolean);

	const candidates = await handle
		.select({ id: document.id, ext: document.ext })
		.from(document)
		.leftJoin(documentText, eq(documentText.documentId, document.id))
		.where(
			and(
				isNotNull(document.storedName),
				// Either never read, or read only in part — a slice that stopped at
				// the limit is still work waiting.
				or(isNull(documentText.documentId), eq(documentText.complete, false)),
				already.length > 0 ? notInArray(document.id, already) : undefined
			)
		);

	let enqueued = 0;
	for (const candidate of candidates) {
		if (!isExtractable(candidate.ext)) continue;
		await handle.insert(job).values({
			id: uuidv7(),
			kind: 'extract_text',
			subjectId: candidate.id
		});
		enqueued++;
	}
	return enqueued;
}
