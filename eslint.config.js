import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import noRawGeometry from './eslint-rules/no-raw-geometry.js';

const LICENCE_HEADER = '// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0';

// Written here rather than pulled in as a plugin: it is twenty lines, and a
// dependency that stamps a comment is a dependency to audit, pin and update
// forever.
//
// `.svelte` files take the header inside the first <script> block, not as an
// HTML comment at the top of the file — a markup comment is part of the
// component's output, and the licence of the source does not belong in the DOM
// the reader's browser receives.
const licence = {
	rules: {
		header: {
			meta: {
				type: 'problem',
				fixable: 'code',
				schema: [],
				messages: { missing: 'File is missing the SPDX licence header.' }
			},
			create(context) {
				return {
					Program(node) {
						const text = context.sourceCode.getText();
						if (text.includes(LICENCE_HEADER)) return;

						context.report({
							node,
							messageId: 'missing',
							fix(fixer) {
								if (!context.filename.endsWith('.svelte')) {
									return fixer.insertTextBeforeRange([0, 0], `${LICENCE_HEADER}\n`);
								}
								// After the opening <script ...> tag, so the header lands in the
								// component's script rather than in its markup.
								const open = text.indexOf('>', text.indexOf('<script'));
								if (open === -1) return null;
								return fixer.insertTextAfterRange([open + 1, open + 1], `\n\t${LICENCE_HEADER}`);
							}
						});
					}
				};
			}
		}
	}
};

export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: { parser: ts.parser }
		},
		rules: {
			// The app is always served from the domain root on a home server;
			// plain hrefs are fine and keep the nav registry simple.
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		// Rune modules — `.svelte.ts` — are handed to the Svelte parser by the
		// plugin's recommended config so it can see `$state` outside a component.
		// That parser still needs TypeScript underneath it, or every type
		// annotation in the file reads as a syntax error.
		files: ['**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: { parser: ts.parser }
		}
	},
	{
		// src/ only: the tests and the build scripts are not distributed.
		files: ['src/**/*.ts', 'src/**/*.svelte'],
		plugins: { licence },
		rules: { 'licence/header': 'error' }
	},
	{
		// Enforced rather than remembered, like the licence header above it. The
		// escape hatch is /* geometry-exempt: why */ — deliberate and greppable, so
		// stepping outside the scale is a decision somebody can find later rather
		// than a number that drifted in.
		files: ['src/**/*.svelte'],
		plugins: { design: { rules: { 'no-raw-geometry': noRawGeometry } } },
		rules: { 'design/no-raw-geometry': 'error' }
	},
	{
		ignores: [
			'.svelte-kit/',
			'build/',
			'node_modules/',
			'drizzle/',
			'design_system/',
			'design_system_V2/',
			'design_system_V3/',
			'bank_data_examples_do_not_share/',
			'scratch-workspace/',
			// Generated at build time out of node_modules by
			// scripts/prepare-opencv.mjs — vendor output, not source.
			'static/opencv/',
			'.remember/',
			// Design handoffs are references, not source: their prototype runtimes
			// are scaffolding the README says outright is nothing to port.
			'docs/superpowers/specs/**/*.js'
		]
	}
);
