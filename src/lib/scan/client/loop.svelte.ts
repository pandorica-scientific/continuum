// SPDX-License-Identifier: AGPL-3.0-or-later
// Stability, and the words the user reads while aiming.
//
// Both exist to help someone FRAME a page, and nothing more: the viewfinder no
// longer takes the picture by itself, so settling is a cue that the outline can
// be trusted rather than a countdown to a shutter. Three agreeing frames — about
// 350 ms at 9 fps — is enough to stop the outline flickering between two
// readings of a page that is not quite still.

import type { Corners, DetectState } from '../core/index.ts';

/** ~9fps. Detecting faster does not improve the outline and starves the main thread. */
export const DETECT_INTERVAL_MS = 110;
export const STABLE_FRAMES = 3;
/** All four corners must have moved less than this share of the frame's width. */
export const STABLE_TOLERANCE = 0.02;
/** Below this, the instruction strobes and cannot be read. */
export const GUIDANCE_DEBOUNCE_MS = 400;
const CORNERS = ['tl', 'tr', 'br', 'bl'] as const;

export function createStability(frameWidth: number) {
	let previous: Corners | null = null;
	let agreed = 0;

	function settled(state: DetectState): boolean {
		// Only a CLEAN detection counts. A rejected frame has corners but failed
		// a gate, and auto-capturing a blurry page is the exact outcome the gates
		// exist to prevent.
		if (state.kind !== 'detected') {
			previous = null;
			agreed = 0;
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

	return { settled };
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
