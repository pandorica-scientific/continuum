<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
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

	// The board's one mode, owned here so the button that flips it can sit in
	// the header beside the title rather than in a bar of its own under it.
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
