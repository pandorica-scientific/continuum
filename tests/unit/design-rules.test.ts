// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import noRawShadow, { ALLOWED } from '../../eslint-rules/no-raw-shadow.js';
import opaqueFloatingSurface from '../../eslint-rules/opaque-floating-surface.js';

/**
 * The two design rules that used to be prose, and the tokens they enforce.
 *
 * `docs/ui-guidelines.md` said "No shadows anywhere" and put it on the
 * before-you-ship checklist while eighteen `box-shadow` declarations quietly
 * failed it; the floating-surface rule was a suite that read every `.svelte`
 * file off disk and re-implemented a CSS parser with a regex. Both are lint
 * rules now — they report on the file that broke them, in the same pass as the
 * licence header — and this is what holds the rules themselves.
 *
 * The fixtures are plain JS whose source happens to contain a `<style>` block,
 * exactly as `no-raw-geometry.test.ts` does: the rules read the block as text,
 * because ESLint does not parse CSS inside a Svelte component.
 */
const tester = new RuleTester();

describe('design/no-raw-shadow', () => {
	const run = (valid: unknown[], invalid: unknown[]) =>
		tester.run('no-raw-shadow', noRawShadow as never, { valid, invalid } as never);

	it('accepts the elevation tokens', () => {
		expect(() =>
			run(
				[
					{ code: 'const c = `<style>.a{box-shadow:var(--shadow-float);}</style>`;' },
					{ code: 'const c = `<style>.a{box-shadow:var(--shadow-raise);}</style>`;' },
					{ code: 'const c = `<style>.a{box-shadow:var(--shadow-card);}</style>`;' },
					{ code: 'const c = `<style>.a{box-shadow:var(--shadow-hero);}</style>`;' },
					{ code: 'const c = `<style>.a{box-shadow:none;}</style>`;' }
				],
				[]
			)
		).not.toThrow();
	});

	it('leaves an inset marker alone, which is not elevation at all', () => {
		// `inset 3px 0 0 var(--teal)` is a left rail drawn with the one property
		// that can paint inside a cell without taking layout space. Four matrices
		// and the documents list use it.
		expect(() =>
			run([{ code: 'const c = `<style>.a{box-shadow:inset 3px 0 0 var(--teal);}</style>`;' }], [])
		).not.toThrow();
	});

	it('rejects a hand-written elevation', () => {
		expect(() =>
			run(
				[],
				[
					{
						code: 'const c = `<style>.a{box-shadow:0 10px 30px rgb(0 0 0 / 0.55);}</style>`;',
						errors: [{ messageId: 'rawShadow' }]
					}
				]
			)
		).not.toThrow();
	});

	it('demands a reason from an exemption', () => {
		expect(() =>
			run(
				[],
				[
					{
						code: 'const c = `<style>/* shadow-exempt: */\\n.a{box-shadow:0 1px 2px red;}</style>`;',
						errors: [{ messageId: 'exemptionNeedsReason' }]
					}
				]
			)
		).not.toThrow();
	});
});

describe('design/opaque-floating-surface', () => {
	const run = (valid: unknown[], invalid: unknown[]) =>
		tester.run(
			'opaque-floating-surface',
			opaqueFloatingSurface as never,
			{
				valid,
				invalid
			} as never
		);

	it('accepts an opaque ground under a floating element', () => {
		expect(() =>
			run(
				[{ code: 'const c = `<style>.a{position:absolute;background:var(--bg2);}</style>`;' }],
				[]
			)
		).not.toThrow();
	});

	it('accepts a translucent card that does not float', () => {
		expect(() =>
			run([{ code: 'const c = `<style>.a{background:var(--card2);}</style>`;' }], [])
		).not.toThrow();
	});

	it('rejects a translucent ground under a floating element', () => {
		// Correct-looking in the light theme, where the same token is opaque hex.
		expect(() =>
			run(
				[],
				[
					{
						code: 'const c = `<style>.a{position:fixed;background:var(--card);}</style>`;',
						errors: [{ messageId: 'translucentFloat' }]
					}
				]
			)
		).not.toThrow();
	});
});

describe('the elevation tokens', () => {
	it('defines exactly the ones the rule allows', () => {
		// A lint rule that has drifted from the tokens it enforces is worse than
		// no lint rule — the same reason `no-raw-geometry.test.ts` reads app.css.
		// Read from the rule's own list rather than restated here, so adding a
		// fifth elevation token cannot pass by updating one of the two copies.
		const css = readFileSync('src/lib/styles/app.css', 'utf8');
		const allowed = ALLOWED.map((v) => `${v.slice('var('.length, -1)}:`).sort();
		for (const name of allowed) expect(css).toMatch(new RegExp(`${name}\\s*[^;]+;`));
		const defined = [...css.matchAll(/--shadow-[a-z-]+:/g)].map((m) => m[0]);
		expect([...new Set(defined)].sort()).toEqual(allowed);
	});
});
