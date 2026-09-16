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
		// A camera frame is not a themed surface: overriding these for the light theme
		// would make them unreadable over a dark kitchen at night.
		for (const token of ['--scan-plate', '--scan-plate-edge', '--scan-ink']) {
			expect(light).not.toContain(`${token}:`);
		}
	});

	it('carries detection state in weight and dash, not colour alone', () => {
		// found/stable/rejected must be separable in greyscale, since the backdrop's
		// luminance is unknown. `searching` deliberately draws nothing.
		expect(css).toMatch(/--detect-w-found:\s*2px/);
		expect(css).toMatch(/--detect-w-stable:\s*3px/);
		expect(css).toMatch(/--detect-dash-rejected:\s*\d+ \d+/);
	});

	it('reads the safe area from env() rather than a guessed constant', () => {
		expect(css).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
		// A landscape phone has insets on the long edges too.
		expect(css).toMatch(/--safe-left:\s*env\(safe-area-inset-left, 0px\)/);
	});

	it('holds the touch floor at 44px, above the 36px form-row control', () => {
		expect(css).toMatch(/--touch-min:\s*44px/);
		expect(css).toMatch(/--control-h:\s*36px/);
	});

	it('neutralises transitions under reduced motion, not only animations', () => {
		// Both are motion; the preference asks about both.
		expect(reducedMotion).toContain('transition-duration: 1ms !important');
		expect(reducedMotion).toContain('animation-duration: 1ms !important');
	});

	it('re-asserts the 90ms button press inside that block', () => {
		// The colour change still reports the press, which is what carries the information.
		expect(reducedMotion).toMatch(/button\s*\{[^}]*transition-duration:\s*90ms/);
	});
});
