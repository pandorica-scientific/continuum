<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import MetricTile from './MetricTile.svelte';
	import type { Tile } from './tiles';

	let { tiles }: { tiles: Tile[] } = $props();
</script>

<!-- The only way figures appear at the top of a screen. As many columns as
     tiles, so a shelf's three and a loan screen's four share one component and
     cannot drift apart on gap or padding. -->
<div class="band" style:--columns={tiles.length}>
	{#each tiles as tile (tile.label)}
		<MetricTile
			label={tile.label}
			value={tile.value}
			unit={tile.unit}
			note={tile.note}
			color={tile.color}
		/>
	{/each}
</div>

<style>
	.band {
		display: grid;
		grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
		gap: var(--space-6);
	}
	/* Four figures at 360px are four unreadable columns. Two rows of two keeps
	   the value legible, which is the only thing a tile is for. */
	@media (max-width: 720px) {
		.band {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
