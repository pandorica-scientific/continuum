// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import noRawShadow, { ALLOWED } from '../../eslint-rules/no-raw-shadow.js';
import opaqueFloatingSurface from '../../eslint-rules/opaque-floating-surface.js';
import noEmojiEyebrow from '../../eslint-rules/no-emoji-eyebrow.js';

// Fixtures are plain JS whose source contains a `<style>` block; the rules
// read it as text, since ESLint does not parse CSS inside a Svelte component.
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

describe('design/no-emoji-eyebrow', () => {
	// A tester of its own: RuleTester remembers the cases it has run for a rule
	// name, and a second `run` for the same name is checked against the first.
	const run = (valid: unknown[], invalid: unknown[]) =>
		new RuleTester().run('no-emoji-eyebrow', noEmojiEyebrow as never, { valid, invalid } as never);

	it('accepts an Eyebrow with a stroke icon, or none', () => {
		expect(() =>
			run(
				[
					{ code: 'const c = `<Eyebrow hue="--teal" icon="chart" label="X" />`;' },
					{ code: 'const c = `<Eyebrow label="X" />`;' },
					// A tile that IS data keeps its emoji; the rule is about Eyebrow only.
					{ code: 'const c = `<IconTile emoji="🏦" size={30} />`;' }
				],
				[]
			)
		).not.toThrow();
	});

	it('rejects an Eyebrow with an emoji', () => {
		expect(() =>
			run(
				[],
				[
					{
						code: 'const c = `<Eyebrow hue="--teal" emoji="📊" label="X" />`;',
						errors: [{ messageId: 'emojiEyebrow' }]
					},
					{
						code: 'const c = `<Eyebrow\n\temoji={mark}\n\tlabel="X" />`;',
						errors: [{ messageId: 'emojiEyebrow' }]
					}
				]
			)
		).not.toThrow();
	});
});

describe('the elevation tokens', () => {
	it('defines exactly the ones the rule allows', () => {
		// Reads from the rule's own list rather than restating it, so adding a
		// token can't pass by updating only one of the two copies.
		const css = readFileSync('src/lib/styles/app.css', 'utf8');
		const allowed = ALLOWED.map((v) => `${v.slice('var('.length, -1)}:`).sort();
		for (const name of allowed) expect(css).toMatch(new RegExp(`${name}\\s*[^;]+;`));
		const defined = [...css.matchAll(/--shadow-[a-z-]+:/g)].map((m) => m[0]);
		expect([...new Set(defined)].sort()).toEqual(allowed);
	});
});
