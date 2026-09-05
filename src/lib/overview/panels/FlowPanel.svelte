<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import FlowCard from '$lib/charts/FlowCard.svelte';

	// The period control is in the panel's head row, drawn by the board from
	// the registry's `headControls`; this is the body under it.
	let {
		data,
		currency
	}: {
		// FlowCard owns this shape; the panel only passes it through.
		data: Parameters<typeof FlowCard>[1]['flow'];
		currency: string;
	} = $props();
</script>

<FlowCard flow={data} {currency} />
