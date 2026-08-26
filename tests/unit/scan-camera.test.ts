// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { isSecureForCamera } from '$lib/scan/client/camera.svelte';
import {
	DETECT_INTERVAL_MS,
	GUIDANCE_DEBOUNCE_MS,
	HOLD_MS,
	STABLE_FRAMES,
	createStability,
	guidanceFor
} from '$lib/scan/client/loop.svelte';
import type { Corners, DetectState } from '$lib/scan/core/types';

describe('isSecureForCamera', () => {
	it('is true over https', () => {
		expect(isSecureForCamera({ protocol: 'https:', hostname: 'ledger.example' })).toBe(true);
	});

	it('is true on localhost, which browsers treat as secure', () => {
		expect(isSecureForCamera({ protocol: 'http:', hostname: 'localhost' })).toBe(true);
		expect(isSecureForCamera({ protocol: 'http:', hostname: '127.0.0.1' })).toBe(true);
		expect(isSecureForCamera({ protocol: 'http:', hostname: '[::1]' })).toBe(true);
	});

	it('is FALSE on a plain-http LAN address — the self-hosting case that matters', () => {
		// This is the whole reason the insecure-origin screen and the native
		// camera fallback exist. Getting it wrong means a self-hoster is told
		// their device has no camera.
		expect(isSecureForCamera({ protocol: 'http:', hostname: '192.168.68.51' })).toBe(false);
		expect(isSecureForCamera({ protocol: 'http:', hostname: 'continuum.lan' })).toBe(false);
	});
});

const at = (offset: number): Corners => ({
	tl: { x: 10 + offset, y: 10 },
	tr: { x: 610 + offset, y: 10 },
	br: { x: 610 + offset, y: 350 },
	bl: { x: 10 + offset, y: 350 }
});
const detected = (offset = 0): DetectState => ({ kind: 'detected', corners: at(offset) });

describe('createStability', () => {
	it('settles after three frames that agree', () => {
		const stability = createStability(640);
		expect([detected(), detected(), detected()].map((s) => stability.settled(s))).toEqual([
			false,
			false,
			true
		]);
		expect(STABLE_FRAMES).toBe(3);
	});

	it('does not settle while the page is still moving', () => {
		const stability = createStability(640);
		// 20px on a 640px frame is over the 2% tolerance.
		expect([detected(0), detected(20), detected(40)].map((s) => stability.settled(s))).toEqual([
			false,
			false,
			false
		]);
	});

	it('tolerates hand tremor under 2% of frame width', () => {
		const stability = createStability(640);
		expect([detected(0), detected(5), detected(9)].map((s) => stability.settled(s))).toEqual([
			false,
			false,
			true
		]);
	});

	it('starts over when the page is lost', () => {
		const stability = createStability(640);
		stability.settled(detected());
		stability.settled(detected());
		expect(stability.settled({ kind: 'searching' })).toBe(false);
		// Counting from one again, not resuming at two.
		expect(stability.settled(detected())).toBe(false);
	});

	it('never settles on a rejected frame — that is what the gates are for', () => {
		// A rejected frame HAS corners. Auto-capturing one is exactly the outcome
		// the quality gates exist to prevent.
		const stability = createStability(640);
		const rejected: DetectState = { kind: 'rejected', corners: at(0), reason: 'blurry' };
		expect([rejected, rejected, rejected].map((s) => stability.settled(s))).toEqual([
			false,
			false,
			false
		]);
	});

	it('scales its tolerance with the frame, not with a pixel count', () => {
		const wide = createStability(1280);
		// 9px is under 2% of 1280 but over 2% of 640 would not matter here — the
		// point is that the same hand tremor reads the same at any frame size.
		expect([detected(0), detected(12), detected(24)].map((s) => wide.settled(s))).toEqual([
			false,
			false,
			true
		]);
	});
});

describe('guidanceFor', () => {
	it('names what the user controls, in every state', () => {
		expect(guidanceFor({ kind: 'searching' })).toBe('Point at the page');
		expect(guidanceFor(detected())).toBe('Hold steady');
		expect(guidanceFor({ kind: 'stable', corners: at(0) })).toBe('Got it — hold still');
		expect(guidanceFor({ kind: 'rejected', corners: null, reason: 'blurry' })).toBe(
			'Hold still — that came out blurry'
		);
		expect(guidanceFor({ kind: 'rejected', corners: null, reason: 'dark' })).toBe(
			'Too dark — try more light'
		);
		expect(guidanceFor({ kind: 'rejected', corners: null, reason: 'small' })).toBe(
			'Move closer to the page'
		);
	});

	it('tells the user what to do, not what the sensor thinks', () => {
		const lines = (['blurry', 'dark', 'small'] as const).map((reason) =>
			guidanceFor({ kind: 'rejected', corners: null, reason })
		);
		for (const line of lines) {
			expect(line).not.toMatch(/contour|illumination|threshold|detect|sensor/i);
		}
	});
});

describe('the loop timings', () => {
	it('detects at about 9fps — fast enough to track, slow enough to drain', () => {
		expect(DETECT_INTERVAL_MS).toBeGreaterThanOrEqual(100);
		expect(DETECT_INTERVAL_MS).toBeLessThanOrEqual(125);
	});

	it('adds up to under two seconds of holding still', () => {
		// Three frames to enter stable, then the full ring. The design's six
		// frames PLUS the ring came to ~2.2s, which is too long to ask of
		// someone leaning over a table.
		expect(STABLE_FRAMES * DETECT_INTERVAL_MS + HOLD_MS).toBeLessThan(2000);
	});

	it('debounces guidance slowly enough to be read', () => {
		expect(GUIDANCE_DEBOUNCE_MS).toBeGreaterThanOrEqual(300);
	});
});
