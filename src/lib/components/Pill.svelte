<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';
	import type { Hue } from '$lib/ui/hue';

	let { hue = 'grey', children }: { hue?: Hue; children: Snippet } = $props();

	const color = $derived(hue === 'grey' ? 'var(--fg3)' : `var(--${hue})`);
</script>

<span class="pill mono" style:color style:background="var(--{hue}-tint)" style:border-color={color}>
	{@render children()}
</span>

<style>
	.pill {
		display: inline-block;
		border: 1px solid;
		border-radius: var(--radius-xl);
		padding: var(--space-1) var(--space-5);
		font-size: var(--text-xs);
		font-weight: 600;
		line-height: 1.2;
		white-space: nowrap;
	}
</style>
