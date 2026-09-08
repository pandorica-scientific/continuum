// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One scan child per instance, and one request at a time through it.
 *
 * NOT one child per session. A session cannot be allowed to hold the child,
 * because two people scanning would then mean one waiting for the other to
 * FINISH SCANNING rather than waiting for a single render. The child belongs to
 * the instance, serves whoever asks next, and exits when nobody has asked for a
 * while — which is the only way its Emscripten heap is ever reclaimed. See
 * `worker/entry.ts` for why exiting is the only way.
 *
 * The serialisation idiom is the one `jobs/dispatcher.ts` uses for its sweep: a
 * module-scope promise that the next caller chains onto. It is deliberately NOT
 * the CPU queue. That queue is FIFO with a ten-minute lease because extraction
 * is batch work nobody is watching; a scan is a button press someone is looking
 * at, and putting one behind the other would need preemption in a module whose
 * whole design note is that there is ONE claim.
 */
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { uuidv7 } from 'uuidv7';
import type { PendingScanRequest, ScanReply, ScanRequest } from './protocol';

/**
 * How long the child outlives the last request.
 *
 * Long enough that flipping between modes, dragging a corner and keeping a page
 * never pays the ~250 ms start again; short enough that a finished scan does
 * not leave 165 MB resident on a small box for the rest of the afternoon.
 */
export const IDLE_EXIT_MS = 2 * 60 * 1000;

/**
 * How long one request may take before the child is presumed wedged.
 *
 * The BACKSTOP, not the first line of defence: the child gives OpenCV its own
 * thirty seconds to start and reports failure properly. This catches the case
 * that reporting cannot — a child stuck inside a native call, which answers
 * nothing and exits never. Without it the caller waits on a promise that will
 * not settle, which on a phone is the reading screen staying up for ever. That
 * was the v0.8.5 failure, and moving the work to a server would otherwise have
 * moved the silence rather than removed it.
 *
 * Generous: a 12 MP page on a slow box is seconds, not minutes.
 */
export const REQUEST_TIMEOUT_MS = 90 * 1000;

/**
 * Where the bundle is.
 *
 * Built by `scripts/build-scan-worker.mjs`, and resolved from the working
 * directory rather than this module's own URL — the server runs as `node build`
 * from the project root in development and from `/app` in the image, and the
 * OCR module finds its models the same way with `resolve('tessdata')`.
 */
export const WORKER_PATH = () => resolvePath('build/scan-worker.cjs');

let child: ChildProcess | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

export function scanChildAlive(): boolean {
	return child !== null && child.connected;
}

/**
 * In development, rebuild the bundle when its sources have moved on.
 *
 * The child is a BUILT artefact, so editing `worker/pipeline.ts` and reloading
 * changes nothing — the fork still runs the last build. That failure is silent
 * and looks exactly like the code being wrong: during this feature's own
 * development it presented as HEIC support that had just been written and did
 * not work. `npm run predev` builds it once; this keeps it honest afterwards.
 *
 * Never in production, where the image ships a bundle built at image-build time
 * and has no esbuild to rebuild it with.
 */
function rebuildIfStale(): void {
	if (process.env.NODE_ENV === 'production') return;
	const bundle = WORKER_PATH();
	const built = existsSync(bundle) ? statSync(bundle).mtimeMs : 0;

	const newest = (dir: string): number => {
		if (!existsSync(dir)) return 0;
		return readdirSync(dir).reduce((latest, entry) => {
			const path = resolvePath(dir, entry);
			const info = statSync(path);
			return Math.max(latest, info.isDirectory() ? newest(path) : info.mtimeMs);
		}, 0);
	};

	const sources = Math.max(newest('src/lib/server/scan'), newest('src/lib/scan/core'));
	if (sources <= built) return;
	execFileSync('node', ['scripts/build-scan-worker.mjs'], { stdio: 'inherit' });
}

function start(): ChildProcess {
	rebuildIfStale();
	return fork(WORKER_PATH(), [], {
		// The child is CPU-bound and short-lived. It inherits stdio only so that
		// a crash has somewhere to be seen.
		stdio: ['ignore', 'inherit', 'inherit', 'ipc']
	});
}

function touchIdle(): void {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(() => void shutdownScanChild(), IDLE_EXIT_MS);
	// A pending exit must never be the thing keeping the server alive.
	idleTimer.unref?.();
}

/**
 * Ask the child to do one thing, after whatever is already in flight.
 *
 * A crash mid-request REJECTS rather than hanging: an OpenCV allocation failure
 * kills the child, and the caller has to hear about it rather than wait for a
 * reply that is not coming. The next request forks a fresh one, so one bad
 * photograph does not disable scanning until the server is restarted.
 */
export function ask(request: PendingScanRequest): Promise<Extract<ScanReply, { ok: true }>> {
	const run = queue.then(() => once(request));
	// The chain must not break on a rejection, or one failure would strand every
	// later request behind a promise that never settles.
	queue = run.catch(() => undefined);
	return run;
}

function once(request: PendingScanRequest): Promise<Extract<ScanReply, { ok: true }>> {
	if (!scanChildAlive()) child = start();
	const active = child!;
	const id = uuidv7();

	return new Promise((resolve, reject) => {
		const deadline = setTimeout(() => {
			cleanup();
			// Killed rather than left: a wedged child is holding ~165 MB and will
			// answer nothing, and the next request deserves a fresh one.
			if (child === active) child = null;
			active.kill('SIGKILL');
			reject(new Error('The scanner took too long and was stopped.'));
		}, REQUEST_TIMEOUT_MS);
		deadline.unref?.();

		function cleanup() {
			clearTimeout(deadline);
			active.off('message', onMessage);
			active.off('exit', onExit);
			active.off('error', onError);
			touchIdle();
		}
		function onMessage(reply: ScanReply) {
			// Replies are matched by id. Nothing else is in flight today, but a
			// stray reply from a previous request answering the wrong caller is
			// the kind of thing that only shows up under load.
			if (reply.id !== id) return;
			cleanup();
			if (reply.ok) resolve(reply);
			else reject(new Error(reply.error));
		}
		function onExit(code: number | null) {
			if (child === active) child = null;
			cleanup();
			reject(new Error(`The scanner stopped unexpectedly (exit ${code ?? 'unknown'}).`));
		}
		function onError(error: Error) {
			if (child === active) child = null;
			cleanup();
			reject(error);
		}

		active.on('message', onMessage);
		active.on('exit', onExit);
		active.on('error', onError);
		active.send({ ...request, id } as ScanRequest);
	});
}

/** Stop the child now, and let its heap go with it. */
export async function shutdownScanChild(): Promise<void> {
	if (idleTimer) {
		clearTimeout(idleTimer);
		idleTimer = null;
	}
	const active = child;
	child = null;
	if (!active || !active.connected) {
		active?.kill('SIGKILL');
		return;
	}
	await new Promise<void>((done) => {
		const settle = setTimeout(() => {
			// A child wedged inside OpenCV will not hear `disconnect`.
			active.kill('SIGKILL');
			done();
		}, 2000);
		settle.unref?.();
		active.once('exit', () => {
			clearTimeout(settle);
			done();
		});
		active.disconnect();
	});
}
