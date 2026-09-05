<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import FlowCard from '$lib/charts/FlowCard.svelte';
	import PeriodControls from '$lib/charts/PeriodControls.svelte';

	let {
		data,
		currency
	}: {
		// FlowCard owns this shape; the panel only passes it through.
		data: Parameters<typeof FlowCard>[1]['flow'];
		currency: string;
	} = $props();
</script>

<!--
	The window comes out of the figures rather than off a prop of its own: the
	loader clamps the anchor against what the record holds, so the only period
	the controls can show is the one the chart beneath them was drawn for.
-->
<div class="flow">
	<PeriodControls
		period={data.period}
		anchor={data.anchor}
		bounds={data.bounds}
		caption={data.caption}
	/>
	<FlowCard flow={data} {currency} />
</div>

<style>
	.flow {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	/* The period control sits on the panel's right, under its title, as the
	   handoff's head row draws it; the caption it carries names the window. */
	.flow > :global(.row) {
		justify-content: flex-end;
	}
</style>
