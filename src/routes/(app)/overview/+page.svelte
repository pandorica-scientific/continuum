<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Board from '$lib/overview/Board.svelte';
	import { panelAvailable } from '$lib/overview/panels';

	let { data } = $props();

	const monthName = new Date().toLocaleString('en', { month: 'long', year: 'numeric' });
	const available = $derived((key: string) => panelAvailable(key, data.modules));
</script>

<ScreenHeader
	title="Overview"
	caption="{monthName} · the panels you chose, arranged the way you left them"
/>

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
	period={data.period}
	currency={data.baseCurrency}
	{available}
/>
