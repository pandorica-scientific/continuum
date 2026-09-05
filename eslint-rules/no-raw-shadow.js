// SPDX-License-Identifier: AGPL-3.0-or-later
// Elevation comes from a token, and only where something actually floats.
//
// `docs/ui-guidelines.md` said "No shadows anywhere" and put it on the
// before-you-ship checklist, and eighteen `box-shadow` declarations across
// thirteen files quietly failed it. That is the worst state for a rule to be
// in: written down, believed, and unchecked — so every diff that added one
// passed review and the rule slowly meant nothing.
//
// The rule was also wrong as stated. A tooltip or a picker floats over
// unpredictable content, and its shadow is what tells a reader where the page
// stopped and the overlay began; deleting those would have made the product
// worse in the name of a sentence. So the sentence changed, and this checks the
// version that is actually true:
//
//   - `none` and `inherit` are fine.
//   - `inset` is fine and is NOT elevation. `inset 3px 0 0 var(--teal)` is a
//     left rail marker drawn with the one property that can paint inside a cell
//     without taking layout space.
//   - anything else must be `var(--shadow-float)` or `var(--shadow-raise)`.
//
// Read as TEXT, like the licence and geometry rules beside it: ESLint does not
// parse CSS inside a Svelte component.

export const ALLOWED = [
	'var(--shadow-float)',
	'var(--shadow-raise)',
	// v2 (0.8.1): a card in the flow IS raised now, by one quiet value, and the
	// hero and quick-add by a second that is lit rather than dropped. The rule
	// this file was written to enforce has not changed — elevation still comes
	// from a token — only the list of tokens it may come from.
	'var(--shadow-card)',
	'var(--shadow-hero)'
];
const EXEMPT = /\/\*\s*shadow-exempt\s*:\s*([^*]*?)\s*\*\//;

/** @type {import('eslint').Rule.RuleModule} */
export default {
	meta: {
		type: 'problem',
		docs: { description: 'box-shadow comes from an elevation token' },
		schema: [],
		messages: {
			rawShadow:
				'box-shadow: {{value}} — elevation comes from a token: var(--shadow-float) for something that floats over content, var(--shadow-raise) for a subtle lift. Nothing in the document flow is raised: a card is separated by its ground and its border. If this one genuinely is neither, mark it /* shadow-exempt: why */.',
			exemptionNeedsReason: 'A shadow exemption must say why: /* shadow-exempt: the reason */.'
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

				const lines = text.slice(start + 1, end).split('\n');
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];

					const exemption = line.match(EXEMPT);
					if (exemption) {
						if (!exemption[1]) context.report({ node, messageId: 'exemptionNeedsReason' });
						continue;
					}
					// An exemption comment covers the declaration on the line after it.
					if (EXEMPT.test(lines[i - 1] ?? '')) continue;

					const match = line.match(/(?<![-\w])box-shadow\s*:\s*([^;]+);/);
					if (!match) continue;
					const value = match[1].trim();
					if (value === 'none' || value === 'inherit') continue;
					// An inset is a marker painted inside the box, not elevation.
					if (value.startsWith('inset ')) continue;
					if (ALLOWED.includes(value)) continue;
					context.report({ node, messageId: 'rawShadow', data: { value } });
				}
			}
		};
	}
};
