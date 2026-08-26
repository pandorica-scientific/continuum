// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The OpenCV handle, and the two probes used to audit its memory.
//
// This module does NOT load OpenCV. The import is type-only and therefore
// erased, so nothing here pulls the WebAssembly into a bundle — which is what
// keeps `core` free of the DOM and free of a 10 MB dependency. Loading lives in
// `client/opencv-load.ts`, because it needs a document.

import type cv from '@techstark/opencv-js';

export type CV = typeof cv;

/**
 * The Emscripten heap, in bytes.
 *
 * A Mat's `.data` is a typed-array VIEW onto the WASM linear memory, so its
 * backing ArrayBuffer is the whole heap — which is how this reads a number the
 * module does not export. Neither `wasmMemory` nor `HEAPU8` exists on the
 * object OpenCV hands back, and the obvious probe for those returns 0 forever:
 * a leak check written against them passes on a heap it cannot see, which is
 * worse than having no leak check.
 *
 * The heap grows and never shrinks, so a leak is a number that goes up and
 * stays up.
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
	// Emscripten runtime exports, present on the module but absent from the
	// package's hand-written .d.ts.
	const heap = cv as unknown as { _malloc(bytes: number): number; _free(pointer: number): void };
	const pointer = heap._malloc(16);
	heap._free(pointer);
	return pointer;
}
