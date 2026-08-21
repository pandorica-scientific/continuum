<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { goto } from '$app/navigation';
	import FlowCard from '$lib/charts/FlowCard.svelte';
	import Segmented from '$lib/components/Segmented.svelte';

	let {
		data,
		period,
		currency
	}: {
		// FlowCard owns this shape; the panel only passes it through.
		data: Parameters<typeof FlowCard>[1]['flow'];
		period: string;
		currency: string;
	} = $props();
</script>

<div class="head">
	<span class="caption">{data.caption}</span>
	<Segmented
		options={[
			{ value: 'ytd', label: 'Year to date' },
			{ value: 'month', label: 'This month' }
		]}
		value={period}
		onchange={(v) => goto(`?period=${v}`, { keepFocus: true, noScroll: true })}
	/>
</div>
<FlowCard flow={data} {currency} />

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-6);
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.caption {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
