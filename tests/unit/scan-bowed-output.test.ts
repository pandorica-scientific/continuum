// SPDX-License-Identifier: AGPL-3.0-or-later
// A bowed page comes out the same size a flat one would.
//
// `outputSize` snaps to A4 and clamps to A4-at-300-dpi; the bowed path measures
// its own span from the boundary curves instead, and for a while it skipped the
// clamp entirely. The result was not an error — it was an output roughly the
// arc length of the page in SOURCE pixels, so a bowed page photographed at 48
// MP asked for about 7000×9800: a 274 MB Mat plus the remap maps beside it, on
// the 2 GB box whose limits are the reason `meshMaps` stripes at all. It also
// meant a flat page and a bowed one landed in the same PDF at two resolutions.
//
// Loaded in-process rather than in the scan child, like the colour test: what
// is under test is the size the renderer asks for, not the plumbing around it.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { MAX_OUTPUT_WIDTH } from '$lib/scan/core/geometry';
import { renderPage } from '$lib/scan/core/enhance';
import type { CV } from '$lib/scan/core/opencv';
import type { Frame, Outline } from '$lib/scan/core/types';

const nodeRequire = createRequire(`${process.cwd()}/`);

/** Emscripten's module is a thenable that resolves to itself; see the child's entry point. */
const cv: Promise<CV> = new Promise((resolve) => {
	const loaded = nodeRequire('@techstark/opencv-js') as CV & { onRuntimeInitialized?: () => void };
	const detach = (module: CV) => {
		delete (module as { then?: unknown }).then;
		return module;
	};
	if (loaded.Mat) resolve(detach(loaded));
	else loaded.onRuntimeInitialized = () => resolve(detach(loaded));
});

/** A plain grey frame. Nothing here reads the pixels; only the shape matters. */
function grey(width: number, height: number): Frame {
	const data = new Uint8ClampedArray(width * height * 4).fill(200);
	for (let i = 3; i < data.length; i += 4) data[i] = 255;
	return { data, width, height };
}

/** A page filling most of a large frame, bowed 120 px along its top edge. */
const bowed: Outline = {
	corners: {
		tl: { x: 20, y: 20 },
		tr: { x: 2980, y: 20 },
		br: { x: 2980, y: 3980 },
		bl: { x: 20, y: 3980 }
	},
	edges: { top: [{ x: 1500, y: 140 }], right: [], bottom: [], left: [] }
};

/** One frame for the whole file: at 3000×4000 it is 48 MB, and nothing mutates it. */
const frame = grey(3000, 4000);

describe('a page that is not flat', () => {
	it('is rendered no larger than a flat page would be', async () => {
		const page = renderPage(await cv, frame, bowed, 'original');
		expect(page.width).toBeLessThanOrEqual(MAX_OUTPUT_WIDTH);
		// Clamped by scaling rather than by cropping: the arc-length measurement
		// is the whole point of the bowed path, and it has to survive the ceiling.
		expect(page.height / page.width).toBeCloseTo(3960 / 2960, 1);
	}, 60_000);

	it('is rendered at the resolution a flat page in the same frame is', async () => {
		// Two pages in one document at two resolutions is what the missing clamp
		// actually looked like from outside.
		const flat = renderPage(await cv, frame, { corners: bowed.corners }, 'original');
		const curved = renderPage(await cv, frame, bowed, 'original');
		expect(curved.width).toBe(flat.width);
	}, 60_000);
});
