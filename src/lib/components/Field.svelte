<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';

	// A labelled control: the shape that appeared about twenty-nine times with
	// `.field` defined independently in five stylesheets.
	//
	// The control is a CHILD rather than a prop. Every input, select and custom
	// control in the product keeps working unchanged and nothing has to be taught
	// a new API to be wrapped; a component taking `type` and `value` would need a
	// case for each of them and would still not cover the sites that put two
	// controls in one field.
	//
	// It renders exactly what it replaces — a bare `<span>` inside
	// `<label class="field">`, no extra classes and no styles of its own. The
	// planned version gave the caption `font-weight: 500`, which would have
	// restyled every form in the product while claiming to change nothing.
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<label class="field">
	<span>{label}</span>
	{@render children()}
</label>
