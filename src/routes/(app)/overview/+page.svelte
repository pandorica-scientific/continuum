<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Board from '$lib/overview/Board.svelte';
	import { panelAvailable } from '$lib/overview/panels';
	import { monthLabel } from '$lib/cashflow/period';

	let { data } = $props();

	// The month the figures are actually about, not today's. A household that
	// imports a statement in the second week of August is looking at July, and
	// the old caption told them it was August.
	const caption = $derived(
		data.dataMonth
			? `${monthLabel(data.dataMonth)} · as of the latest statement`
			: 'No statements yet · the panels you chose, arranged the way you left them'
	);
	const available = $derived((key: string) => panelAvailable(key, data.modules));
</script>

<ScreenHeader title="Overview" {caption} />

<!--
	Deliberately not wrapped in {#key data.layout}: the loader builds a fresh
	array every load, so keying on it remounted the board on every invalidation.
	Adding a panel calls invalidateAll(), which then dropped the person out of
	Customise mode and threw away the "not saved" notice along with the panel it
	referred to. The board owns the arrangement once it is mounted.
-->
<Board
	layout={data.layout}
	panels={data.panels}
	currency={data.baseCurrency}
	{available}
	firstRun={data.firstRun}
/>
