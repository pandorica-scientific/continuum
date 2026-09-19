// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which queued files the Import screen still has something to say about.
 *
 * The queue is what is still happening. A statement that read cleanly leaves
 * it the moment it is done — it is in "Recent imports" by then, with the
 * checks that accepted it, and listing it in both said the same thing twice
 * while a wall of finished rows sat over the drop zone.
 *
 * A failure is the exception, and stays: it never reached Recent imports, so
 * this row is the only place it is reported and the only place its columns can
 * be mapped by hand. A file that cannot tell which account it belongs to is a
 * failure of that kind — `needsAccount` always travels with an error.
 *
 * Pure, so the rule is one testable sentence rather than a filter buried in
 * markup.
 */
export interface QueueJobView {
	state: string;
	/** A job that never ran: the reader threw before producing a result. */
	error?: string | null;
	/** A job that ran and reported it could not file the file. */
	result?: { error?: string | null } | null;
}

export function stillInQueue(job: QueueJobView): boolean {
	if (job.state === 'queued' || job.state === 'running') return true;
	return Boolean(job.error || job.result?.error);
}
