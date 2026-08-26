// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Stability, and the words the user reads while holding the phone still.
//
// The design and the pipeline brief disagreed: six consecutive stable frames
// AND a 1500ms ring is about 2.2 seconds of holding still, which is too long to
// ask of someone leaning over a table. Settled on three frames (~350ms at 9fps)
// to ENTER stable, then the full ring — about 1.85s in total. The ring is a
// plain timer rather than a live confidence value: simpler, and it matches the
// design's "the fill runs its full length".

import type { Corners, DetectState } from '../core/index.ts';

/** ~9fps. Detecting faster does not improve the outline and starves the main thread. */
export const DETECT_INTERVAL_MS = 110;
export const STABLE_FRAMES = 3;
/** All four corners must have moved less than this share of the frame's width. */
export const STABLE_TOLERANCE = 0.02;
/** Below this, the instruction strobes and cannot be read. */
export const GUIDANCE_DEBOUNCE_MS = 400;
/** The auto-capture window; must match --motion-hold. */
export const HOLD_MS = 1500;

const CORNERS = ['tl', 'tr', 'br', 'bl'] as const;

export function createStability(frameWidth: number) {
	let previous: Corners | null = null;
	let agreed = 0;

	function reset() {
		previous = null;
		agreed = 0;
	}

	function settled(state: DetectState): boolean {
		// Only a CLEAN detection counts. A rejected frame has corners but failed
		// a gate, and auto-capturing a blurry page is the exact outcome the gates
		// exist to prevent.
		if (state.kind !== 'detected') {
			reset();
			return false;
		}

		const limit = frameWidth * STABLE_TOLERANCE;
		const still =
			previous !== null &&
			CORNERS.every((corner) => {
				const a = previous![corner];
				const b = state.corners[corner];
				return Math.hypot(b.x - a.x, b.y - a.y) < limit;
			});

		agreed = still ? agreed + 1 : 1;
		previous = state.corners;
		return agreed >= STABLE_FRAMES;
	}

	return { settled, reset };
}

/**
 * Every line names what the USER controls. "Too dark — try more light" tells
 * them what to do with their free hand; "Insufficient illumination" tells them
 * what the sensor thinks.
 */
export function guidanceFor(state: DetectState): string {
	switch (state.kind) {
		case 'searching':
			return 'Point at the page';
		case 'detected':
			return 'Hold steady';
		case 'stable':
			// No longer a promise that something is about to happen by itself:
			// the shutter is the only way a page is taken now.
			return 'Looks good — take it';
		case 'rejected':
			switch (state.reason) {
				case 'blurry':
					return 'Hold still — that came out blurry';
				case 'dark':
					return 'Too dark — try more light';
				case 'angle':
					// Says what to do with the hand holding the phone, not what the
					// geometry looked like.
					return 'Hold the camera flat over the page';
				default:
					return 'Move closer to the page';
			}
	}
}
