// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The scan child.
 *
 * This process exists so that OpenCV's heap can be thrown away. Emscripten
 * memory grows and never shrinks: measured, a node process sits at 38 MB, 145
 * MB once OpenCV has initialised, and 203 MB after one 12 MP frame — and it
 * stays at 203 through `Mat.delete()`, through dropping the module, through
 * evicting it from the require cache, and through two forced garbage
 * collections. EXITING IS THE ONLY RECLAIM. That is the whole argument for a
 * separate process, and it is why `heic-decode.ts`'s rule against "a permanent
 * floor nobody is watching" survives this release rather than being reversed by
 * it: the floor is real, it is just not in the web server any more.
 *
 * OpenCV is reached through `createRequire` and never through `import`.
 * `await import('@techstark/opencv-js')` under node does not fail — it HANGS,
 * with no error, no resolution, and nothing that points at this file. The same
 * package through `require` returns in 88 ms and initialises in 158 ms.
 */
import { createRequire } from 'node:module';
import type { CV } from '$lib/scan/core/index';
import type { ScanRequest } from '../protocol';
import { runDetect, runOriginal, runRender } from './pipeline';

/**
 * The listener is registered before anything else in this file.
 *
 * Node emits `message` on an EventEmitter, and an event with no listener is
 * DROPPED rather than queued. The parent sends as soon as `fork` returns, so
 * any work done before subscribing is a race — and the OpenCV load below is
 * ~90 ms of it, which loses that race every time. The symptom is a child that
 * has read nothing, with no error to say so.
 *
 * `serve` is a function declaration so it can be named here and defined below.
 * It is only ever called from an event, which cannot arrive until this module
 * has finished evaluating.
 */
process.on('message', (request: ScanRequest) => void serve(request));

// A child whose parent has gone must not linger holding 165 MB.
process.on('disconnect', () => process.exit(0));

/**
 * A second way out, because the first one needs a working event loop.
 *
 * `disconnect` is an event, so a child wedged in a spin cannot hear it — and a
 * spinning orphan is not theoretical: twelve of them accumulated during this
 * feature's development, each holding a core at 70% and reparented to init when
 * the process that forked them exited. The cause was the thenable unwrap above,
 * which is fixed, but "the parent went away and nobody noticed" deserves a
 * guard that does not depend on the same loop being healthy.
 *
 * The parent kills an idle child long before this fires. This is for the child
 * that no longer has a parent to do it.
 */
const IDLE_SELF_EXIT_MS = 10 * 60 * 1000;
let lastSeen = Date.now();
setInterval(() => {
	if (Date.now() - lastSeen > IDLE_SELF_EXIT_MS) process.exit(0);
}, 60_000).unref?.();

// Resolved from the working directory rather than from this file's own URL: the
// bundle lands in build/ while node_modules sits beside it at the project root,
// which holds in development and at /app in the image alike. The OCR module
// locates its models the same way, with `resolve('tessdata')`.
const nodeRequire = createRequire(`${process.cwd()}/`);

/**
 * EMSCRIPTEN'S MODULE IS A THENABLE THAT RESOLVES TO ITSELF:
 *
 *   Module.then = function (func) {
 *     if (calledRun) func(Module); else …onRuntimeInitialized = () => func(Module);
 *     return Module;                      // also thenable
 *   };
 *
 * It never removes itself, so handing the module to `resolve()` — or awaiting
 * it — sends the promise machinery into an endless unwrap: it sees a thenable,
 * calls `then`, is handed the same thenable, and starts again. In a browser
 * that is a frozen tab. Here it is a child that loads OpenCV correctly, reports
 * `onRuntimeInitialized`, and then never answers anything, with the event loop
 * starved and no stack anywhere to point at the cause.
 *
 * The browser loader this replaces carried the same guard and very nearly this
 * comment. The trap did not move with the code, so the guard has to.
 */
function detach(cv: CV): CV {
	delete (cv as { then?: unknown }).then;
	return cv;
}

/**
 * How long the runtime gets to start before the wait is called off.
 *
 * Emscripten does not REJECT anything when it cannot get a heap: it aborts by
 * throwing inside its own callback, so `onRuntimeInitialized` simply never
 * fires. With nothing else watching, every request waits for the life of the
 * process — which on a phone is the reading screen staying up for ever, with
 * no error and no way out. That was the v0.8.5 bug, and moving the work to a
 * server does not fix it, it only moves where the silence is.
 */
const READY_TIMEOUT_MS = 30_000;

/**
 * OpenCV, started at module load rather than on the first request.
 *
 * Nothing is lost by being eager: this process is forked only when there is
 * scanning to do, so loading at start IS loading on demand, one level up. It
 * also spends the ~160 ms while the photograph is still arriving rather than
 * after it has.
 */
const ready: Promise<CV> = new Promise<CV>((resolve, reject) => {
	const deadline = setTimeout(
		() =>
			reject(new Error('The scanner could not start, most likely short of memory on the server.')),
		READY_TIMEOUT_MS
	);
	// The deadline must never be the reason the process stays alive.
	deadline.unref?.();

	const settle = (cv: CV) => {
		clearTimeout(deadline);
		resolve(detach(cv));
	};

	try {
		const cv = nodeRequire('@techstark/opencv-js') as CV & { onRuntimeInitialized?: () => void };
		// `Mat` is the cheapest proof that the runtime is already up.
		if (cv.Mat) settle(cv);
		else cv.onRuntimeInitialized = () => settle(cv);
	} catch (cause) {
		clearTimeout(deadline);
		reject(cause instanceof Error ? cause : new Error(String(cause)));
	}
});

// A rejection with nothing attached yet is an unhandled rejection, which under
// node kills the process before it can report anything useful. The handler
// below is what reports it; this only stops the default from firing first.
ready.catch(() => {});

async function serve(request: ScanRequest): Promise<void> {
	lastSeen = Date.now();
	try {
		// `original` neither needs OpenCV nor waits for it. It is the corner
		// screen's fallback, and a box too short of memory to give Emscripten a
		// heap can still hand back a photograph to place handles on — which is
		// exactly the box where that fallback matters most.
		let result;
		switch (request.op) {
			case 'original':
				result = await runOriginal(request);
				break;
			case 'detect':
				result = await runDetect(await ready, request);
				break;
			default:
				result = await runRender(await ready, request);
		}
		process.send?.({ id: request.id, ok: true, ...result });
	} catch (error) {
		// A failure is REPORTED, never thrown away. The parent is waiting on a
		// reply carrying this id, and a child that dies quietly leaves it waiting
		// on a promise that will not settle.
		process.send?.({
			id: request.id,
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		});
	}
}
