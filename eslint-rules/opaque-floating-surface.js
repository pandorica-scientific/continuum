// SPDX-License-Identifier: AGPL-3.0-or-later
// A floating element must not be painted with a translucent token.
//
// `--card`, `--card2` and `--card3` are TINTS in the dark theme —
// `rgba(255,255,255,0.03)` and friends — designed to sit on the page background
// and read as a slightly raised panel. That works for a card in the document
// flow. It does not work for anything that floats: whatever is behind shows
// straight through, and the text becomes unreadable.
//
// It is a trap because it looks correct in the light theme, where the same
// tokens are opaque hex. It was found by looking at a tooltip in dark mode, not
// by any check — which is why one exists now. Use `--bg` or `--bg2`, opaque in
// both themes.
//
// This was a test that read every `.svelte` file off disk and parsed its style
// block with a regex. It belongs here instead: it is a rule about a diff, it
// reports on the file that broke it, and it runs in the same pass as the licence
// header and the geometry scale rather than as a suite that only fails after the
// fact.

const TRANSLUCENT = ['--card', '--card2', '--card3'];

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'a floating element is painted with an opaque token' },
		schema: [],
		messages: {
			translucentFloat:
				'{{selector}} floats and is painted with var({{token}}), which is translucent in the dark theme — whatever is behind will show through the text. Use --bg or --bg2, which are opaque in both.'
		}
	},
	/** @param {import('eslint').Rule.RuleContext} context */
	create(context) {
		return {
			Program(node) {
				const text = context.sourceCode.getText();
				const start = text.indexOf('<style');
				const end = text.indexOf('</style>', start);
				if (start === -1 || end === -1) return;
				const style = text.slice(start + 1, end);

				// Flat rules only. A rule nested inside @media still matches
				// `selector { … }` on its own, so the same scan covers both.
				const pattern = /([^{}]+)\{([^{}]*)\}/g;
				let match;
				while ((match = pattern.exec(style)) !== null) {
					const [, selector, body] = match;
					if (!/position:\s*(absolute|fixed)/.test(body)) continue;
					for (const token of TRANSLUCENT) {
						// `background:` or `background-color:`, but not `background-image`
						// and not a border — only the surface the text sits on.
						const paints = new RegExp(`background(-color)?:[^;]*var\\(\\s*${token}\\s*[,)]`);
						if (paints.test(body)) {
							context.report({
								node,
								messageId: 'translucentFloat',
								data: { selector: selector.trim(), token }
							});
						}
					}
				}
			}
		};
	}
};
