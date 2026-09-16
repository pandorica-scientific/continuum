<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';

	// A labelled control. The control is a CHILD rather than a prop, so any
	// input/select/custom control keeps working unchanged instead of needing a
	// case in a `type`/`value` API — including sites with two controls in one
	// field. Renders exactly what it replaces: no extra classes, no own styles.
	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<label class="field">
	<span>{label}</span>
	{@render children()}
</label>
