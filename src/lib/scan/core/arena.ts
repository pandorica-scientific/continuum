// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Manual memory management, because a cv.Mat is not a JavaScript object.
//
// A Mat is a handle of a few dozen bytes pointing into the WASM linear heap,
// which the JS garbage collector cannot see into. Letting one go out of scope
// frees the handle and none of the pixels. There is no finalizer and no WeakRef
// hook that runs: `.delete()` is the only thing that frees anything.
//
// One detection frame is ~1.7 MB and one page render is ~118 MB, so the failure
// mode is not a slow drip — it is a dead tab on page two, with an OOM raised
// from inside the WASM module where no JS handler can catch it. Scattering
// `.delete()` calls and hoping does not survive an early return or a throw,
// which is why everything goes through an arena that unwinds in a `finally`.
//
// Four rules cover every bug in this class:
//
//  1. Every cv.* object with a `.delete()` goes through `keep()` in the SAME
//     expression that creates it, never a line later.
//  2. `contours.get(i)` returns a NEW Mat every call. Deleting the MatVector
//     does not free them. This is the most commonly missed one.
//  3. Return plain data, never a Mat. If a function must hand one outward, use
//     `keep.release()` so the transfer is explicit and greppable.
//  4. Never `await` inside `withMats`. An interleaved frame allocates against a
//     heap the arena is about to unwind, and the ordering becomes untestable.

/** Anything with a `.delete()` — Mat, MatVector, CLAHE, and the rest. */
export type Disposable = { delete(): void };

export type Arena = (<M extends Disposable>(m: M) => M) & {
	/** Hand ownership to the caller: the arena stops tracking it. */
	release<M extends Disposable>(m: M): M;
};

export function withMats<T>(fn: (keep: Arena) => T): T {
	const tracked = new Set<Disposable>();
	const keep = (<M extends Disposable>(m: M) => {
		tracked.add(m);
		return m;
	}) as Arena;
	keep.release = <M extends Disposable>(m: M): M => {
		tracked.delete(m);
		return m;
	};

	try {
		return fn(keep);
	} finally {
		for (const m of tracked) {
			try {
				m.delete();
			} catch {
				// Already deleted, or deleted twice by a caller being careful.
				// Neither is worth failing a render over.
			}
		}
	}
}
