// SPDX-License-Identifier: AGPL-3.0-or-later
// Geometry comes from the scale in app.css, not from a number somebody picked.
//
// Written here rather than pulled in as a plugin, following the licence rule
// beside it: a dependency that checks two CSS properties is a dependency to
// audit, pin and update forever.
//
// It reads the <style> block as TEXT. ESLint does not parse CSS inside a Svelte
// component, and adding a CSS parser to police `gap` and `border-radius` would
// cost more than it saves.
//
// It flags a raw pixel value ONLY when a token already exists for it. That is
// the difference between standardising a codebase and restyling it: this
// product genuinely uses 1px spacing granularity — 5, 7, 9 and 11px gaps in
// sixty places — and no scale contains all of those without being a list rather
// than a scale. Snapping them to the nearest token was measured: individually
// invisible, and in aggregate it moved all fourteen screens.
//
// So the rule enforces the one thing that is always true: if the scale has a
// name for this number, use the name. That is what stops `gap: 8px` creeping
// back in beside `gap: var(--space-4)` and drifting apart again.
//
// `padding` is deliberately NOT covered. It was measured: 51 distinct two-value
// pairs whose horizontal component is dominated by ODD numbers — 11px in 27
// places, 14px in 20, plus 13, 15, 9 and 7 — so a scale would mean restyling
// the product rather than describing it. Padding drift is a duplication
// problem, and the global control styles and the Field primitive solve it by
// leaving one copy to drift from.

// The scale, mirroring app.css. A unit test reads app.css and asserts these
// agree, because a lint rule that has drifted from the tokens it enforces is
// worse than no lint rule.
/** @type {Record<number, string>} */
const RADIUS = { 4: 'xs', 6: 'sm', 8: 'md', 10: 'lg', 12: 'xl', 16: '2xl', 999: 'pill' };
/** @type {Record<number, number>} */
const SPACE = { 2: 1, 4: 2, 6: 3, 8: 4, 10: 5, 12: 6, 14: 7, 16: 8 };

const PROPERTIES = ['border-radius', 'gap', 'row-gap', 'column-gap'];
const EXEMPT = /\/\*\s*geometry-exempt\s*:\s*([^*]*?)\s*\*\//;

export default {
	meta: {
		type: 'problem',
		schema: [],
		messages: {
			rawGeometry:
				'{{prop}}: {{value}} has a name — use {{token}}. Raw values beside tokens are how the two drift apart. If this one is deliberately off the scale, mark it /* geometry-exempt: why */.',
			exemptionNeedsReason: 'A geometry exemption must say why: /* geometry-exempt: the reason */.'
		}
	},
	/** @param {import('eslint').Rule.RuleContext} context */
	create(context) {
		return {
			/** @param {import('estree').Program} node */
			Program(node) {
				const text = context.sourceCode.getText();
				const open = text.indexOf('<style');
				if (open === -1) return;
				const start = text.indexOf('>', open);
				const end = text.indexOf('</style>', start);
				if (start === -1 || end === -1) return;

				const lines = text.slice(start + 1, end).split('\n');

				// Indexed, NOT `for...of` with `lines.indexOf(line)`: indexOf returns
				// the FIRST line equal to this one, and in a stylesheet — where `}`
				// and blank lines repeat constantly — the previous-line lookup below
				// would read some unrelated part of the file.
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];

					const exemption = line.match(EXEMPT);
					if (exemption) {
						if (!exemption[1]) context.report({ node, messageId: 'exemptionNeedsReason' });
						continue;
					}
					// An exemption comment covers the declaration on the line after it.
					if (EXEMPT.test(lines[i - 1] ?? '')) continue;

					for (const prop of PROPERTIES) {
						const match = line.match(new RegExp(`(?<![-\\w])${prop}\\s*:\\s*([^;]+);`));
						if (!match) continue;
						const value = match[1].trim();
						// EVERY part of a shorthand, not just a lone value. The rule
						// matched `^(\d+)px$` for a long time, so `gap: 8px` was caught and
						// `gap: 8px 14px` went straight through — with both numbers on the
						// scale. Twenty files carried one, which is the failure mode a
						// mechanical rule exists to prevent: it looked enforced.
						//
						// A shorthand is only reported when EVERY part is a raw pixel value
						// the scale names. Mixing a token with a number — `var(--space-4) 3px`
						// — is a deliberate choice about one axis and not a drifted number.
						const parts = value.split(/\s+/);
						const pixels = parts.map((part) => /^(\d+)px$/.exec(part)?.[1]);
						if (pixels.some((digits) => digits === undefined)) continue;
						const tokens = pixels.map((digits) => {
							const n = Number(digits);
							return prop === 'border-radius'
								? RADIUS[n] && `--radius-${RADIUS[n]}`
								: SPACE[n] && `--space-${SPACE[n]}`;
						});
						// No token for one of these numbers: the scale does not claim to
						// cover every value, and inventing one here would restyle the
						// product.
						if (tokens.some((token) => !token)) continue;
						const token = tokens.map((name) => `var(${name})`).join(' ');
						context.report({ node, messageId: 'rawGeometry', data: { prop, value, token } });
					}
				}
			}
		};
	}
};
