// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Load OpenCV from the app's own origin, as a script rather than a bundle.
//
// `@techstark/opencv-js` ships a single 10.4 MB file with 7.6 MB of WebAssembly
// inlined as a base64 data URI. Bundling that does not just load slowly — it
// hangs the tab outright, with no error, because Emscripten refuses to
// stream-compile a data URI and instead decodes 10.6 million base64 characters
// and compiles them in one uninterruptible go.
//
// `scripts/prepare-opencv.mjs` splits the package into static/opencv/{opencv.js,
// opencv.wasm} at build time. Loaded that way the binary streams and OpenCV is
// ready in about 245 ms, with the main thread responsive throughout.
//
// Self-hosted, never a CDN: the product refuses one for its icons and its OCR
// language data, and a docs.opencv.org dependency in a self-hosted app would be
// a contradiction.

import type { CV } from '../core/index.ts';

/** Written into static/ by scripts/prepare-opencv.mjs. */
const LOADER = '/opencv/opencv.js';

let ready: Promise<CV> | null = null;

/**
 * Emscripten's Module is a THENABLE THAT RESOLVES TO ITSELF:
 *
 *   Module.then = function (func) {
 *     if (calledRun) func(Module); else …onRuntimeInitialized = () => func(Module);
 *     return Module;                      // also thenable
 *   };
 *
 * It never removes itself. So handing the module to `resolve()` — or awaiting
 * it — sends the promise machinery into an endless unwrap: it sees a thenable,
 * calls `then`, is handed the same thenable, and starts again. That starves the
 * event loop with no error and no stack, which is a frozen tab.
 *
 * Deleting `then` before the module ever touches a promise is what stops it.
 * Nothing is lost: `onRuntimeInitialized` below is the same signal `then` was
 * wrapping, and it is the documented hook for non-modularised builds.
 */
function detach(cv: CV): CV {
	delete (cv as { then?: unknown }).then;
	return cv;
}

export function loadCv(): Promise<CV> {
	// Memoised: the detection loop calls this every frame rather than holding a
	// reference, so a caller can never reach `cv` before the runtime is up.
	// Making it cheap is what makes that safe.
	ready ??= new Promise<CV>((resolve, reject) => {
		const already = (globalThis as { cv?: CV }).cv;
		if (already?.Mat) return resolve(detach(already));

		const script = document.createElement('script');
		script.src = LOADER;
		script.async = true;
		script.onerror = () =>
			reject(new Error('The scanner could not load. Reload the page and try again.'));
		script.onload = () => {
			const cv = (globalThis as { cv?: CV }).cv;
			if (!cv) return reject(new Error('The scanner loaded but did not start.'));
			// The script defines `cv` at once; the WebAssembly behind it lands a
			// moment later, and only then is `Mat` a constructor.
			if (cv.Mat) return resolve(detach(cv));
			const previous = cv.onRuntimeInitialized;
			cv.onRuntimeInitialized = () => {
				previous?.();
				resolve(detach(cv));
			};
		};
		document.head.appendChild(script);
	});
	return ready;
}
