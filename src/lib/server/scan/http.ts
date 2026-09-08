// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What every scan endpoint needs, in one place.
 *
 * These routes live at `/scan`, NOT under `/api`. That prefix is a bearer-token
 * boundary for external clients — `authorizeApiRequest` applies `requireToken`
 * to everything beneath it, and `PUBLIC_PATHS` exempts it from the sign-in
 * redirect on that understanding. A browser session carries a cookie and no
 * token, so putting these there would have meant loosening `isApiPath`, which
 * is the one thing holding an unauthenticated route from shipping beside the
 * versioned ones. Under `/scan` the ordinary session rule in `hooks.server.ts`
 * applies and nothing has to be relaxed.
 */
import { error } from '@sveltejs/kit';
import { holdCpuQueueForScan } from '$lib/server/jobs';
import { ask } from './child';
import { isScanId } from './session';
import type { PendingScanRequest, ScanReply } from './protocol';

/**
 * An id off the wire, answered for rather than thrown over.
 *
 * `session.ts` checks these as well and must — it is the guard between a URL
 * parameter and the filesystem, and a `..` that gets through it is a read or a
 * delete anywhere the server can reach. But it throws a plain `Error`, which
 * SvelteKit reports as a 500 and `handleError` logs with a stack trace and an
 * error reference. A stale link or a mistyped id is not a server fault; it is a
 * 400, and saying so keeps the log for things that are.
 */
export function scanId(value: string | null | undefined, what: string): string {
	if (!value || !isScanId(value)) error(400, `That is not a ${what}.`);
	return value;
}

/**
 * Run one piece of scan work, with the CPU queue standing back around it.
 *
 * Every route goes through here rather than calling `ask` directly, so the hold
 * cannot be forgotten on one path — and it releases in a `finally`, because a
 * scan that throws must not leave the queue held for the life of the process.
 */
export async function scanWork(
	request: PendingScanRequest
): Promise<Extract<ScanReply, { ok: true }>> {
	const release = holdCpuQueueForScan();
	try {
		return await ask(request);
	} catch (cause) {
		// The child's own message is the useful one — "the scanner stopped
		// unexpectedly", a missing file, an OpenCV failure — and it is safe to
		// show: it names nothing the person cannot already see.
		error(500, cause instanceof Error ? cause.message : 'That page could not be processed.');
	} finally {
		release();
	}
}

/** The JSON body of a request, or a 400 that says what was wrong with it. */
export async function readJson<T>(request: Request): Promise<T> {
	try {
		return (await request.json()) as T;
	} catch {
		error(400, 'That request was not readable.');
	}
}
