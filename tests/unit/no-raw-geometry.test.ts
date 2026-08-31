// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import { readFile } from 'node:fs/promises';
import rule from '../../eslint-rules/no-raw-geometry.js';

// Mirrors the maps inside the rule. The test below asserts both agree with
// app.css, so this cannot quietly fall out of step.
const RADIUS: Record<number, string> = {
	4: 'xs',
	6: 'sm',
	8: 'md',
	10: 'lg',
	12: 'xl',
	16: '2xl',
	999: 'pill'
};
const SPACE: Record<number, number> = { 2: 1, 4: 2, 6: 3, 8: 4, 10: 5, 12: 6, 14: 7, 16: 8 };

// The rule reads the <style> block as text rather than as a parsed stylesheet,
// exactly as the licence rule reads the file as text: ESLint does not parse CSS
// inside a Svelte component. These fixtures are therefore plain JS whose source
// happens to contain a <style> block, which exercises the scanning without
// needing the Svelte parser.
const tester = new RuleTester();
const run = (valid: unknown[], invalid: unknown[]) =>
	tester.run('no-raw-geometry', rule as never, { valid, invalid } as never);

describe('design/no-raw-geometry', () => {
	it('accepts a token', () => {
		expect(() =>
			run([{ code: 'const c = `<style>.a{gap:var(--space-4);}</style>`;' }], [])
		).not.toThrow();
	});

	it('accepts zero and relative units, which are not geometry choices', () => {
		expect(() =>
			run(
				[
					{ code: 'const c = `<style>.a{gap:0;}</style>`;' },
					{ code: 'const c = `<style>.a{gap:0.5rem;}</style>`;' },
					{ code: 'const c = `<style>.a{border-radius:50%;}</style>`;' }
				],
				[]
			)
		).not.toThrow();
	});

	it('rejects a raw value that the scale has a name for', () => {
		expect(() =>
			run(
				[],
				[
					{
						code: 'const c = `<style>.a{gap:8px;}</style>`;',
						errors: [{ messageId: 'rawGeometry' }]
					},
					{
						code: 'const c = `<style>.a{border-radius:12px;}</style>`;',
						errors: [{ messageId: 'rawGeometry' }]
					}
				]
			)
		).not.toThrow();
	});

	// The rule enforces "if the scale names this number, use the name" — not
	// "every number must be on the scale". This product genuinely uses 1px
	// spacing granularity in about sixty places, and snapping those to the
	// nearest token was measured: individually invisible, and in aggregate it
	// moved all fourteen screens. A rule that forced them would be a restyle
	// wearing a lint rule's clothes.
	it('leaves a value the scale has no name for alone', () => {
		expect(() =>
			run(
				[
					{ code: 'const c = `<style>.a{gap:5px;}</style>`;' },
					{ code: 'const c = `<style>.a{gap:11px;}</style>`;' },
					{ code: 'const c = `<style>.a{border-radius:20px;}</style>`;' }
				],
				[]
			)
		).not.toThrow();
	});

	// A lint rule that has drifted from the tokens it enforces is worse than no
	// lint rule: it would pass a codebase that no longer matches its own scale.
	it('agrees with the scale declared in app.css', async () => {
		const css = await readFile('src/lib/styles/app.css', 'utf8');
		const declared = new Set(
			[...css.matchAll(/--(radius-[\w-]+|space-\d+):\s*(\d+)px;/g)].map((m) => `--${m[1]}:${m[2]}`)
		);
		const fromRule = [
			...Object.entries(RADIUS).map(([px, name]) => `--radius-${name}:${px}`),
			...Object.entries(SPACE).map(([px, n]) => `--space-${n}:${px}`)
		];
		for (const entry of fromRule) {
			expect(declared, `${entry} is in the lint rule but not in app.css`).toContain(entry);
		}
	});

	it('accepts a raw value carrying an exemption with a reason', () => {
		expect(() =>
			run(
				[
					{
						code: 'const c = `<style>\n/* geometry-exempt: donut diameter */\n.a{border-radius:148px;}</style>`;'
					}
				],
				[]
			)
		).not.toThrow();
	});

	it('rejects an exemption with no reason', () => {
		expect(() =>
			run(
				[],
				[
					{
						code: 'const c = `<style>\n/* geometry-exempt: */\n.a{border-radius:148px;}</style>`;',
						errors: [{ messageId: 'exemptionNeedsReason' }]
					}
				]
			)
		).not.toThrow();
	});

	it('ignores a file with no style block at all', () => {
		expect(() => run([{ code: 'const gap = "gap:9px;";' }], [])).not.toThrow();
	});
});
