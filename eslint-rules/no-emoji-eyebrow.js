// SPDX-License-Identifier: AGPL-3.0-or-later
// A section head carries a stroke icon, not an emoji.
//
// The v2 handoff's rule: emoji survive only where the household chose them —
// a shelf, an account, a module — and never as section markers. The 0.8.1
// pass put a 26px tile before every panel title and, in the same change,
// filled thirty-six of those tiles with an emoji the code chose (📊 on a chart,
// 🧾 on a bill list, 🤖 on the calendar feeds). They are drawn by the platform,
// differ per device, ignore `color`, and say "this was the quick option".
//
// Read as TEXT, like the shadow and geometry rules beside it: the markup of a
// Svelte component is not on ESLint's tree.

// Built per file: a global regex carries `lastIndex` between calls, and a
// module-level one read by `matchAll` inherits it — the second file it was
// asked about started scanning from where the first one's match ended.
const offence = () => /<Eyebrow\b[^>]*?\bemoji\s*=/g;

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'Eyebrow takes a stroke icon, never an emoji' },
		schema: [],
		messages: {
			emojiEyebrow:
				'Eyebrow takes `icon`, not `emoji` — an emoji is data the household chose (a shelf, an account), never a section mark. Pick a name from src/lib/icons.ts.'
		}
	},
	/** @param {import('eslint').Rule.RuleContext} context */
	create(context) {
		return {
			Program(node) {
				const text = context.sourceCode.getText();
				for (const match of text.matchAll(offence())) {
					context.report({
						node,
						messageId: 'emojiEyebrow',
						loc: context.sourceCode.getLocFromIndex(match.index ?? 0)
					});
				}
			}
		};
	}
};
