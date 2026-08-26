// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * `srcObject` must never be a template binding on the viewfinder.
 *
 * Svelte groups template bindings into one reactive effect. The video sits
 * beside values the detection loop rewrites about nine times a second — the
 * guidance line, the outline geometry, the shutter's state — so the compiler
 * put the stream assignment in that same effect, and it re-ran with them.
 *
 * Reassigning `srcObject` invokes the media element's load algorithm: the
 * element resets to readyState 0 and pauses. The camera was therefore being
 * torn down and restarted nine times a second. It never rendered a frame, the
 * pipeline drew that black element to its canvas, and the engine reported
 * "Too dark — try more light" about a camera that had never started — with the
 * permission granted and the recording indicator lit, which is what made it so
 * hard to see.
 *
 * It has to be attached imperatively, once, guarded by an identity check.
 */
const capture = readFileSync('src/lib/scan/client/ScanCapture.svelte', 'utf8');
const markup = capture.replace(/<script[\s\S]*?<\/script>/g, '');

describe('the viewfinder stream', () => {
	it('is not bound in the template', () => {
		expect(markup).not.toMatch(/srcObject=\{/);
	});

	it('is assigned imperatively instead', () => {
		expect(capture).toMatch(/video\.srcObject = stream/);
	});

	it('does not reassign the same stream', () => {
		// Without this guard the effect restarts the camera every time it runs
		// for an unrelated reason, which is the same bug wearing a hat.
		expect(capture).toMatch(/if \(video\.srcObject === stream\) return;/);
	});

	it('attaches and starts the stream in exactly one place', () => {
		// Two effects racing to start the same element is how the first fix
		// looked, and it is a restart loop waiting to happen.
		expect((capture.match(/video\.srcObject = stream/g) ?? []).length).toBe(1);
		expect((capture.match(/video\s*\.play\(\)/g) ?? []).length).toBe(1);
	});

	it('starts playback explicitly rather than trusting autoplay', () => {
		// Prettier may wrap the chain, so match across whitespace.
		expect(capture).toMatch(/video\s*\.play\(\)/);
	});
});
