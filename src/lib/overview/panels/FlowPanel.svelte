<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import FlowCard from '$lib/charts/FlowCard.svelte';

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
