// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/lib/styles/app.css', 'utf8');
/** Everything from the light-theme block onward. */
const light = css.slice(css.indexOf("html[data-ledger-theme='light']"));
const reducedMotion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

describe('the scan tokens', () => {
	it('defines every axis the scan flow reads', () => {
		const required = [
			'--scan-plate',
			'--scan-plate-edge',
			'--scan-ink',
			'--scan-ink-2',
			'--detect-searching',
			'--detect-found',
			'--detect-stable',
			'--detect-rejected',
			'--detect-w-searching',
			'--detect-w-found',
			'--detect-w-stable',
			'--detect-dash-searching',
			'--detect-dash-rejected',
			'--safe-top',
			'--safe-bottom',
			'--safe-left',
			'--safe-right',
			'--touch-min',
			'--shutter-size',
			'--ease-out'
		];
		expect(required.filter((token) => !css.includes(`${token}:`))).toEqual([]);
	});

	it('declares the motion beats the design specifies but nothing has built yet', () => {
		// Kept apart from the list above on purpose. Every token there is read by
		// a rule somewhere; these three are read by nothing, and never have been.
		// They belong to the design's capture collapse — the outline travelling
		// into the thumbnail — which is specified and not implemented.
		//
		// Asserting them alongside the live tokens made a green suite look like
		// the motion design was delivered. Listed separately, the split is the
		// documentation: values measured and agreed, beats not built. Move one up
		// when a rule starts reading it, and delete this test when the list is
		// empty.
		const reserved = ['--motion-snap', '--motion-capture', '--motion-settle'];
		expect(reserved.filter((token) => !css.includes(`${token}:`))).toEqual([]);
		const stylesheets = readFileSync('src/lib/scan/client/ScanCapture.svelte', 'utf8');
		expect(reserved.filter((token) => stylesheets.includes(`var(${token})`))).toEqual([]);
	});

	it('pins the four scrim tokens across both themes', () => {
		// A camera frame is not a themed surface: its luminance is unknown and
		// changes every frame. `--plate`'s light override is near-white, correct
		// over a light page and unreadable over a dark kitchen at night — which
		// is the primary usage context. Overriding these is a real regression
		// that looks like a consistency fix, so it is tested.
		for (const token of ['--scan-plate', '--scan-plate-edge', '--scan-ink', '--scan-ink-2']) {
			expect(light).not.toContain(`${token}:`);
		}
	});

	it('carries detection state in weight and dash, not colour alone', () => {
		// The four states must be separable in greyscale, and the backdrop is
		// unpredictable regardless.
		expect(css).toMatch(/--detect-w-searching:\s*1\.5px/);
		expect(css).toMatch(/--detect-w-found:\s*2px/);
		expect(css).toMatch(/--detect-w-stable:\s*3px/);
	});

	it('dashes rejected tighter than searching — a different rhythm, not a hue', () => {
		const gap = (name: string) => Number(css.match(new RegExp(`${name}:\\s*\\d+ (\\d+)`))?.[1]);
		expect(gap('--detect-dash-rejected')).toBeLessThan(gap('--detect-dash-searching'));
	});

	it('reads the safe area from env() rather than a guessed constant', () => {
		expect(css).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
		// Left and right matter too: a landscape phone has insets on the long edges.
		expect(css).toMatch(/--safe-left:\s*env\(safe-area-inset-left, 0px\)/);
	});

	it('holds the touch floor at 44px, above the 36px form-row control', () => {
		expect(css).toMatch(/--touch-min:\s*44px/);
		expect(css).toMatch(/--control-h:\s*36px/);
	});

	it('neutralises transitions under reduced motion, not only animations', () => {
		// An animation-only override is what a first pass naturally writes, and
		// it neutralises the obvious sweeps while leaving every transition
		// running at full speed. Both are motion; the preference asks about
		// both.
		expect(reducedMotion).toContain('transition-duration: 1ms !important');
		expect(reducedMotion).toContain('animation-duration: 1ms !important');
	});

	it('re-asserts the 90ms button press inside that block', () => {
		// app.css keeps it deliberately: the colour change still reports the
		// press, which is the part that carries the information.
		expect(reducedMotion).toMatch(/button\s*\{[^}]*transition-duration:\s*90ms/);
	});
});
