// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Where the CPU queue is wired together.
 *
 * The dispatcher must not import the modules it dispatches to — the import
 * queue and the extraction engine would then pull each other in through it —
 * so the handlers are registered here, and everything that runs the queue
 * imports it from this module rather than from the dispatcher directly. That
 * is what guarantees a handler exists by the time a job is claimed.
 */
import { registerHandler } from './dispatcher';
import { runImportJob } from '$lib/server/import/queue';
import { extractDocumentText } from '$lib/server/documents/extract';

registerHandler('import', runImportJob);

registerHandler('extract_text', async (claimed, handle) => {
	if (!claimed.subjectId) return { error: 'An extraction job with no document to read.' };
	const outcome = await extractDocumentText(claimed.subjectId, handle);
	// A stale run is not a failure: the file was replaced while it read, a fresh
	// job is already queued for the new one, and this run correctly wrote nothing.
	return { result: { outcome } };
});

export {
	runCpuQueue,
	clearFinished,
	registerHandler,
	LEASE_MS,
	KEEP_FINISHED_MS,
	CPU_KINDS,
	type CpuKind,
	type JobHandler,
	type JobOutcome,
	type JobRow
} from './dispatcher';
