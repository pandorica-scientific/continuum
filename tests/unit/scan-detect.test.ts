// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
// `detect.ts` imports opencv for its TYPE only, which is erased — so this pulls
// no WASM and runs like any other unit test. `detectOnce` itself needs a real
// runtime and is verified on a device, not here.
import { readFileSync } from 'node:fs';
import { DETECT_WIDTH, orderCorners } from '$lib/scan/core/detect';

describe('orderCorners', () => {
	it('names the four points regardless of the order they arrive in', () => {
		// findContours returns them in whatever order it walked the edge, and a
		// mislabelled corner warps the page inside out.
		const shuffled = [
			{ x: 10, y: 90 },
			{ x: 80, y: 10 },
			{ x: 10, y: 10 },
			{ x: 80, y: 90 }
		];
		expect(orderCorners(shuffled)).toEqual({
			tl: { x: 10, y: 10 },
			tr: { x: 80, y: 10 },
			br: { x: 80, y: 90 },
			bl: { x: 10, y: 90 }
		});
	});

	it('handles a tilted page, where no two corners share an axis', () => {
		const tilted = [
			{ x: 92, y: 34 },
			{ x: 566, y: 58 },
			{ x: 548, y: 330 },
			{ x: 74, y: 306 }
		];
		const { tl, tr, br, bl } = orderCorners(tilted);
		expect(tl).toEqual({ x: 92, y: 34 });
		expect(tr).toEqual({ x: 566, y: 58 });
		expect(br).toEqual({ x: 548, y: 330 });
		expect(bl).toEqual({ x: 74, y: 306 });
	});

	it('does not mutate the array it was given', () => {
		const points = [
			{ x: 10, y: 90 },
			{ x: 80, y: 10 },
			{ x: 10, y: 10 },
			{ x: 80, y: 90 }
		];
		const copy = [...points];
		orderCorners(points);
		expect(points).toEqual(copy);
	});
});

describe('DETECT_WIDTH', () => {
	it('is the one width every corner is measured against', () => {
		// The stability tolerance and the corner rescale both divide by this. If
		// it drifts from what the client actually downscales to, every captured
		// page is cropped wrong.
		expect(DETECT_WIDTH).toBe(640);
	});
});

describe('refinement is opt-in', () => {
	const source = readFileSync('src/lib/scan/core/detect.ts', 'utf8');

	it('is off unless asked for', () => {
		// Measured on real captures, Canny plus Hough across the frame returns
		// ~2000 segments and costs 170-1300 ms. The live loop's budget is 110 ms
		// at 9 fps, so this can only ever run once, at capture.
		expect(source).toMatch(/const refining = options\?\.refine \?\? false;/);
	});

	it('guards the refinement step on the flag', () => {
		expect(source).toMatch(/if \(best && refining\)/);
	});

	it('is asked for at capture time, on the still', () => {
		// And on the STILL rather than the last video frame, so movement between
		// the final tick and the shutter is not baked into the crop.
		const capture = readFileSync('src/lib/scan/client/ScanCapture.svelte', 'utf8');
		expect(capture).toMatch(/detectOnce\(cv, measured, \{ gates: false, refine: true \}\)/);
	});

	it('falls back to the live corners when the second pass finds nothing', () => {
		// A slightly stale crop beats no crop.
		const capture = readFileSync('src/lib/scan/client/ScanCapture.svelte', 'utf8');
		expect(capture).toMatch(/scaleCorners\(corners, full\.width \/ DETECT_WIDTH\)/);
	});
});
