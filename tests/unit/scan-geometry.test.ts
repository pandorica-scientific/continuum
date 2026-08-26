// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
// From the module, not the barrel: the barrel re-exports opencv.ts and pulling
// 10 MB of WASM through Vite's transform hangs the run.
import {
	A4_RATIO,
	MAX_OUTPUT_WIDTH,
	fullFrameCorners,
	hairline,
	outputSize,
	quadAspect,
	scaleCorners
} from '$lib/scan/core/geometry';

const rect = (w: number, h: number) => ({
	tl: { x: 0, y: 0 },
	tr: { x: w, y: 0 },
	br: { x: w, y: h },
	bl: { x: 0, y: h }
});

describe('outputSize', () => {
	it('takes the longer of each opposing pair, so perspective does not shrink the page', () => {
		// A trapezoid: the top edge is short because the far edge of the page is
		// further from the lens. Using it would squeeze the whole page by however
		// far it was tilted.
		const trapezoid = {
			tl: { x: 20, y: 0 },
			tr: { x: 80, y: 0 },
			br: { x: 100, y: 300 },
			bl: { x: 0, y: 300 }
		};
		expect(outputSize(trapezoid).width).toBe(100);
	});

	it('snaps to A4 when it is within 4%, because almost everything here is A4', () => {
		const nearly = rect(1000, 1000 * A4_RATIO * 0.98);
		const { width, height } = outputSize(nearly);
		expect(height / width).toBeCloseTo(A4_RATIO, 3);
	});

	it('leaves a shape that is not nearly A4 alone', () => {
		// A till receipt is 1:4. Snapping that to A4 would be an invention.
		const receipt = rect(400, 1600);
		const { width, height } = outputSize(receipt);
		expect(height / width).toBeCloseTo(4, 3);
	});

	it('snaps a landscape page to A4 the other way up', () => {
		const nearly = rect(1000 * A4_RATIO * 1.01, 1000);
		const { width, height } = outputSize(nearly);
		expect(width / height).toBeCloseTo(A4_RATIO, 3);
	});

	it('clamps the width and keeps the aspect ratio while doing it', () => {
		const huge = rect(6000, 6000 * A4_RATIO);
		const { width, height } = outputSize(huge);
		expect(width).toBe(MAX_OUTPUT_WIDTH);
		expect(height / width).toBeCloseTo(A4_RATIO, 3);
	});

	it('never returns a zero or fractional dimension', () => {
		const { width, height } = outputSize(rect(0.4, 0.4));
		expect(Number.isInteger(width)).toBe(true);
		expect(Number.isInteger(height)).toBe(true);
		expect(width).toBeGreaterThan(0);
		expect(height).toBeGreaterThan(0);
	});

	it('survives four identical corners rather than dividing by zero', () => {
		// Detection can collapse on a blank wall, and a NaN here propagates into
		// the warp as a silently black page.
		const collapsed = outputSize(rect(0, 0));
		expect(Number.isFinite(collapsed.width)).toBe(true);
		expect(Number.isFinite(collapsed.height)).toBe(true);
	});
});

describe('scaleCorners', () => {
	it('carries corners from the detection frame back to the original image', () => {
		// Detection runs at 640px wide; the page is warped from the full-resolution
		// source. Getting this factor wrong crops half the page away.
		expect(scaleCorners(rect(100, 200), 6).br).toEqual({ x: 600, y: 1200 });
	});
});

describe('fullFrameCorners', () => {
	it('is what a failed detection degrades to, never an error', () => {
		expect(fullFrameCorners(640, 480)).toEqual(rect(640, 480));
	});
});

describe('hairline', () => {
	it('never draws thinner than 0.8px', () => {
		expect(hairline(0.2).width).toBe(0.8);
		expect(hairline(0).width).toBe(0.8);
	});

	it('leaves a stroke that is already thick enough alone', () => {
		expect(hairline(3).width).toBe(3);
	});

	it('applies the stroke only from 2.5px up', () => {
		expect(hairline(2.4).stroked).toBe(false);
		expect(hairline(2.5).stroked).toBe(true);
	});
});

describe('quadAspect', () => {
	it('is about 1.41 for A4, either way up', () => {
		expect(quadAspect(rect(1000, 1414))).toBeCloseTo(A4_RATIO, 2);
		expect(quadAspect(rect(1414, 1000))).toBeCloseTo(A4_RATIO, 2);
	});

	it('is 1 for a square', () => {
		expect(quadAspect(rect(500, 500))).toBeCloseTo(1, 5);
	});

	it('is huge for a line of text, which is how one gets rejected', () => {
		// Measured against real photographs, the old edge-based detector outlined
		// a single heading: 0.2% of the frame at roughly 20:1.
		expect(quadAspect(rect(560, 28))).toBeCloseTo(20, 1);
	});

	it('is Infinity rather than NaN for a collapsed quad', () => {
		// Detection can collapse on a blank wall, and a NaN here would sail
		// through every comparison that is meant to reject it.
		expect(quadAspect(rect(0, 0))).toBe(Infinity);
	});
});
