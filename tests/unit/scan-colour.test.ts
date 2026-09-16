// SPDX-License-Identifier: AGPL-3.0-or-later
// Colour mode has to come back the colour it went in.
//
// Regression: correction on a white page hid a fault that washed out coloured
// documents (passports, ID cards) to pale grey.
//
// Loads a real OpenCV, since the fault lives in the arithmetic itself.
import { afterAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { renderPage } from '$lib/scan/core/enhance';
import type { CV } from '$lib/scan/core/opencv';
import type { Frame } from '$lib/scan/core/types';

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

afterAll(() => {
	// Nothing to tear down: this runs in-process rather than in the scan child,
	// which is exactly why it is a small test and not a whole pipeline.
});

/**
 * A strongly coloured card under a lamp, WITH THE PALE MARGIN A REAL CROP HAS.
 *
 * The margin (desk or the card's own light border) lifts the frame's mean
 * brightness above the card's own, which is what reproduces the fault: a
 * card with no margin doesn't trigger it at all.
 */
function card(rgb: [number, number, number], width = 240, height = 320): Frame {
	const data = new Uint8ClampedArray(width * height * 4);
	const margin = Math.round(width * 0.12);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			// A lamp falling across from the top left: bright at one corner, about
			// 40% dimmer at the far one.
			const lamp = 1 - 0.4 * ((x / width) * 0.5 + (y / height) * 0.5);
			const inside = x >= margin && y >= margin && x < width - margin && y < height - margin;
			const [r, g, b] = inside ? rgb : [238, 236, 232];
			const i = (y * width + x) * 4;
			data[i] = Math.round(r * lamp);
			data[i + 1] = Math.round(g * lamp);
			data[i + 2] = Math.round(b * lamp);
			data[i + 3] = 255;
		}
	}
	return { data, width, height };
}

/** Saturation as a share of the brightest channel — 0 is grey, 1 is pure colour. */
function saturation(frame: Frame, at: number): number {
	const r = frame.data[at];
	const g = frame.data[at + 1];
	const b = frame.data[at + 2];
	const high = Math.max(r, g, b);
	const low = Math.min(r, g, b);
	return high === 0 ? 0 : (high - low) / high;
}

/** Which channel is the strongest, which is what "burgundy" or "teal" means. */
function dominant(frame: Frame, at: number): 'r' | 'g' | 'b' {
	const r = frame.data[at];
	const g = frame.data[at + 1];
	const b = frame.data[at + 2];
	if (r >= g && r >= b) return 'r';
	return g >= b ? 'g' : 'b';
}

const middleOf = (frame: Frame) =>
	(Math.floor(frame.height / 2) * frame.width + Math.floor(frame.width / 2)) * 4;

describe('colour mode', () => {
	it('keeps a burgundy passport burgundy', async () => {
		// A passport cover, roughly. The fault turned this pale — hue survived, saturation didn't.
		const source = card([104, 32, 58]);
		const rendered = renderPage(await cv, source, null, 'color');

		const before = saturation(source, middleOf(source));
		const after = saturation(rendered, middleOf(rendered));
		expect(dominant(rendered, middleOf(rendered))).toBe('r');
		// Within a tenth of where it started. The old code lost roughly half.
		expect(after).toBeGreaterThan(before - 0.1);
	}, 60_000);

	it('keeps a teal identity card teal', async () => {
		const source = card([64, 168, 152]);
		const rendered = renderPage(await cv, source, null, 'color');

		const before = saturation(source, middleOf(source));
		const after = saturation(rendered, middleOf(rendered));
		expect(dominant(rendered, middleOf(rendered))).toBe('g');
		expect(after).toBeGreaterThan(before - 0.1);
	}, 60_000);

	it('does not wash a dark cover towards the middle of the range', async () => {
		// A large evenly coloured object must not be read as a shadow and paled.
		const source = card([104, 32, 58]);
		const rendered = renderPage(await cv, source, null, 'color');
		const at = middleOf(rendered);
		const brightness = Math.max(rendered.data[at], rendered.data[at + 1], rendered.data[at + 2]);
		expect(brightness).toBeLessThan(150);
	}, 60_000);

	it('crops in Original mode but leaves the colours completely alone', async () => {
		// Original mode: crop the page but leave the camera's colours untouched.
		const source = card([104, 32, 58]);
		const inset = {
			corners: {
				tl: { x: 30, y: 40 },
				tr: { x: 210, y: 40 },
				br: { x: 210, y: 280 },
				bl: { x: 30, y: 280 }
			}
		};
		const rendered = renderPage(await cv, source, inset, 'original');

		// Cropped: the output is the size of the boundary, not of the photograph.
		expect(rendered.width).toBeLessThan(source.width);
		expect(rendered.height).toBeLessThan(source.height);

		// Untouched: removing the lamp's gradient is a judgement this mode declines to make.
		const corner = (frame: Frame, x: number, y: number) => frame.data[(y * frame.width + x) * 4];
		const spread =
			corner(rendered, 4, 4) - corner(rendered, rendered.width - 5, rendered.height - 5);
		expect(spread).toBeGreaterThan(10);
		expect(dominant(rendered, middleOf(rendered))).toBe('r');
	}, 60_000);

	it('hands back the whole photograph in Original when nothing was found', async () => {
		// The upload path relies on this: no boundary means nothing to crop to.
		const source = card([104, 32, 58]);
		const rendered = renderPage(await cv, source, null, 'original');
		expect(rendered.width).toBe(source.width);
		expect(rendered.height).toBe(source.height);
		expect(rendered.data[0]).toBe(source.data[0]);
	}, 60_000);

	it('still evens out the lamp it was written to remove', async () => {
		// The correction has to keep doing its job: the bright corner and the dim
		// one should be closer together afterwards than they were before.
		const source = card([210, 205, 200]);
		const rendered = renderPage(await cv, source, null, 'color');
		const corner = (frame: Frame, x: number, y: number) => frame.data[(y * frame.width + x) * 4];

		const spreadBefore = corner(source, 4, 4) - corner(source, source.width - 5, source.height - 5);
		const spreadAfter =
			corner(rendered, 4, 4) - corner(rendered, rendered.width - 5, rendered.height - 5);
		expect(spreadAfter).toBeLessThan(spreadBefore);
	}, 60_000);
});
