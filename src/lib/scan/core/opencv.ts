// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The only module that touches the WASM binary.

import cv from '@techstark/opencv-js';

export type CV = typeof cv;

let ready: Promise<CV> | null = null;

/**
 * Memoised deliberately: the detection loop calls this every frame rather than
 * holding a reference, so a caller can never reach `cv` before the runtime is
 * up. Making it cheap is what makes that safe.
 *
 * Pinned to opencv-js 4.x, not 5.x. The 5.0 release exports a PROMISE as its
 * module body, which makes the ES namespace Vite builds for it thenable — and
 * both Vite and Vitest await every module they load, so importing it throws
 * "Promise.prototype.then called on incompatible receiver" before a line of our
 * code runs. 4.x exports a plain object and the usual Emscripten
 * `onRuntimeInitialized` handshake, which every toolchain here handles.
 */
export function loadCv(): Promise<CV> {
	ready ??= new Promise<CV>((resolve) => {
		if (cv.Mat) return resolve(cv);
		cv.onRuntimeInitialized = () => resolve(cv);
	});
	return ready;
}

/**
 * The Emscripten heap, in bytes.
 *
 * A Mat's `.data` is a typed-array VIEW onto the WASM linear memory, so its
 * backing ArrayBuffer is the whole heap — which is how this reads a number the
 * module does not export. v5 exposes neither `wasmMemory` nor `HEAPU8`, and the
 * obvious probe for those returns 0 forever: a leak test written against them
 * passes on a heap it cannot see, which is worse than having no leak test.
 *
 * The heap grows and never shrinks, so a leak is a number that goes up and
 * stays up. That makes it a unit test rather than a bug report.
 */
export function heapBytes(cv: CV): number {
	const probe = new cv.Mat(1, 1, cv.CV_8UC1);
	try {
		return probe.data.buffer.byteLength;
	} finally {
		probe.delete();
	}
}

/**
 * Where the allocator's next block starts — a finer leak signal than the heap.
 *
 * The heap only grows in large steps, so a small leak hides between them. This
 * moves as soon as anything is retained, which catches a single missed
 * `.delete()` that `heapBytes` would not see for thousands of frames.
 */
export function allocMark(cv: CV): number {
	// `_malloc` and `_free` are Emscripten runtime exports, present on the module
	// but absent from the package's hand-written .d.ts.
	const heap = cv as unknown as { _malloc(bytes: number): number; _free(pointer: number): void };
	const pointer = heap._malloc(16);
	heap._free(pointer);
	return pointer;
}
