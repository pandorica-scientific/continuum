import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

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
			'.remember/'
		]
	}
);
