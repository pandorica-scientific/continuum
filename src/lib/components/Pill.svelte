<script lang="ts">
	import type { Snippet } from 'svelte';

	type Hue = 'green' | 'yellow' | 'red' | 'blue' | 'teal' | 'purple' | 'grey';

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
		border-radius: 12px;
		padding: 2px 10px;
		font-size: 11.5px;
		font-weight: 600;
		line-height: 1.2;
		white-space: nowrap;
	}
</style>
