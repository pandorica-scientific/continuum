// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { markupIn } from '../svelte-markup';

/**
 * Two other suites search a component's template and would report the wrong
 * thing if this handed back more than the template.
 */
describe('markupIn', () => {
	it('removes both script blocks and the style block', () => {
		const markup = markupIn(`<script module lang="ts">
	export const NAME = 'trap';
</script>

<script lang="ts">
	let shown = $state(false);
</script>

<p>hello</p>
{#if shown}<span>there</span>{/if}

<style>
	p {
		color: red;
	}
</style>
`);
		expect(markup).toContain('<p>hello</p>');
		expect(markup).toContain('{#if shown}');
		expect(markup).not.toContain('$state');
		expect(markup).not.toContain('export const NAME');
		expect(markup).not.toContain('color: red');
	});

	it('does not leave CSS behind for a template rule to match', () => {
		// The regular expression this replaced stripped only <script>, so a rule
		// searching for `{#await import(` found this and reported a component
		// that has no such thing in its template.
		const markup = markupIn(`<script lang="ts">
	let a = 1;
</script>

<p>{a}</p>

<style>
	p::after {
		content: '{#await import("x")}';
	}
</style>
`);
		expect(markup).not.toMatch(/\{#await\s+import\(/);
	});

	it('keeps a component that has neither block intact', () => {
		expect(markupIn('<p>plain</p>\n').trim()).toBe('<p>plain</p>');
	});
});
