<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import MetricTile from './MetricTile.svelte';
	import type { Tile } from './tiles';

	let { tiles }: { tiles: Tile[] } = $props();
</script>

<!-- The only way figures appear at the top of a screen. As many columns as
     tiles, so a shelf's three and a loan screen's four share one component and
     cannot drift apart on gap or padding. -->
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
	/* auto-fit against a 200px floor rather than a fixed column count: a
	   headline figure must never wrap, and `1fr` columns will happily squeeze
	   five of them to 140px and break "1 234 567 Kč" across two lines. Below the
	   floor the row folds to fewer columns instead. */
	.band {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
