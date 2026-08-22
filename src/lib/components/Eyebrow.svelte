<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import type { Snippet } from 'svelte';

	let {
		emoji,
		label,
		caption,
		right
	}: { emoji?: string; label: string; caption?: string; right?: Snippet } = $props();
</script>

<div class="eyebrow-row">
	<span class="eyebrow">
		{#if emoji}<span style="font-size: var(--text-sm); margin-right: 7px;">{emoji}</span
			>{/if}{label}
	</span>
	{#if right}
		{@render right()}
	{:else if caption}
		<span class="eyebrow-caption">{caption}</span>
	{/if}
</div>
