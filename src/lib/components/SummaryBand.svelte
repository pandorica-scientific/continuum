<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import MetricTile from './MetricTile.svelte';
	import type { Tile } from './tiles';

	let { tiles }: { tiles: Tile[] } = $props();
</script>

<div class="band">
	{#each tiles as tile (tile.label)}
		<MetricTile
			label={tile.label}
			value={tile.value}
			unit={tile.unit}
			note={tile.note}
			color={tile.color}
			wash={tile.wash}
		/>
	{/each}
</div>

<style>
	/* 200px floor so a headline figure never wraps; below it the row folds to
	   fewer columns. */
	.band {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-6);
	}
	@media (max-width: 720px) {
		.band {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
