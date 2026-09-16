<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Board from '$lib/overview/Board.svelte';
	import { panelAvailable } from '$lib/overview/panels';
	import { monthLabel } from '$lib/cashflow/period';

	let { data } = $props();

	// The month the figures are about, not today's — statements lag.
	const caption = $derived(
		data.dataMonth
			? `${monthLabel(data.dataMonth)} · as of the latest statement`
			: 'No statements yet · the panels you chose, arranged the way you left them'
	);
	const available = $derived((key: string) => panelAvailable(key, data.modules));

	// Owned here so the toggle button can live in the header instead of its own bar.
	let customising = $state(false);
</script>

<ScreenHeader title="Overview" {caption}>
	{#snippet actions()}
		<button
			type="button"
			class="btn"
			class:on={customising}
			aria-pressed={customising}
			onclick={() => (customising = !customising)}
		>
			{customising ? 'Done' : 'Customise'}
		</button>
	{/snippet}
</ScreenHeader>

<!--
	Not wrapped in {#key data.layout}: the loader returns a fresh array each load,
	and keying on it would remount the board (and drop Customise mode) on invalidation.
-->
<Board
	layout={data.layout}
	panels={data.panels}
	currency={data.baseCurrency}
	{available}
	firstRun={data.firstRun}
	bind:customising
/>

<style>
	/* Pressed while the board is being arranged: the mode is on the button as
	   well as on every panel's brand edge. */
	.btn.on {
		background: var(--surface-3);
		color: var(--fg1);
	}
</style>
