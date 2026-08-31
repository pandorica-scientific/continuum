// SPDX-License-Identifier: AGPL-3.0-or-later
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
			'--detect-searching',
			'--detect-found',
			'--detect-stable',
			'--detect-rejected',
			'--detect-w-found',
			'--detect-w-stable',
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

	it('pins the four scrim tokens across both themes', () => {
		// A camera frame is not a themed surface: its luminance is unknown and
		// changes every frame. `--plate`'s light override is near-white, correct
		// over a light page and unreadable over a dark kitchen at night — which
		// is the primary usage context. Overriding these is a real regression
		// that looks like a consistency fix, so it is tested.
		for (const token of ['--scan-plate', '--scan-plate-edge', '--scan-ink']) {
			expect(light).not.toContain(`${token}:`);
		}
	});

	it('carries detection state in weight and dash, not colour alone', () => {
		// Three states are DRAWN — found, stable, rejected — and they must be
		// separable in greyscale, because the backdrop is a camera frame and its
		// luminance is unknown. `searching` draws nothing at all, deliberately: no
		// page found means no outline, since a speculative box is a claim the
		// detector has not made (see OUTLINE in ScanCapture.svelte). It therefore
		// has a colour token and no weight or dash, and this test used to pin two
		// tokens nothing could ever read.
		expect(css).toMatch(/--detect-w-found:\s*2px/);
		expect(css).toMatch(/--detect-w-stable:\s*3px/);
		// Found and rejected share a weight, so the dash is what separates them.
		expect(css).toMatch(/--detect-dash-rejected:\s*\d+ \d+/);
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
