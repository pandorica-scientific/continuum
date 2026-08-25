// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
// Imported from the module, not the barrel. The barrel re-exports opencv.ts,
// and pulling a 10 MB WASM bundle through Vite's transform hangs the run — so
// every vitest test here imports the specific pure module it exercises.
import { withMats } from '$lib/scan/core/arena';

function fake() {
	return {
		deleted: false,
		delete() {
			this.deleted = true;
		}
	};
}

describe('withMats', () => {
	it('frees everything it tracked', () => {
		const a = fake();
		const b = fake();
		withMats((keep) => {
			keep(a);
			keep(b);
		});
		expect([a.deleted, b.deleted]).toEqual([true, true]);
	});

	it('frees on the exception path, which is the whole reason it exists', () => {
		// A render that throws half way through is exactly when scattered
		// `.delete()` calls stop running, and it is also when the largest Mats
		// are alive.
		const a = fake();
		expect(() =>
			withMats((keep) => {
				keep(a);
				throw new Error('mid-render');
			})
		).toThrow('mid-render');
		expect(a.deleted).toBe(true);
	});

	it('frees on an early return, which the gates take on most frames', () => {
		const a = fake();
		const out = withMats((keep) => {
			keep(a);
			return 'rejected';
		});
		expect([out, a.deleted]).toEqual(['rejected', true]);
	});

	it('leaves a released object alone so ownership can transfer', () => {
		const a = fake();
		const out = withMats((keep) => keep.release(keep(a)));
		expect(out.deleted).toBe(false);
	});

	it('survives an object that was already deleted', () => {
		const a = fake();
		expect(() =>
			withMats((keep) => {
				keep(a);
				a.delete();
			})
		).not.toThrow();
	});

	it('frees the rest even when one delete throws', () => {
		// One angry Mat must not strand the hundred behind it in the set.
		const angry = {
			delete() {
				throw new Error('already gone');
			}
		};
		const b = fake();
		withMats((keep) => {
			keep(angry);
			keep(b);
		});
		expect(b.deleted).toBe(true);
	});

	it('returns what the body returned', () => {
		expect(withMats(() => 42)).toBe(42);
	});
});
