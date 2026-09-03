<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	let {
		label,
		value,
		unit,
		note,
		color,
		wash,
		compact = false
	}: {
		label: string;
		value: string;
		unit?: string;
		note?: string;
		color?: string;
		/**
		 * A hue token name — `teal`, `green` — whose wash becomes the ground.
		 *
		 * The tile's identity, not its state: `--green-wash` under "Saved" says
		 * which of the four flow figures this is, the way the swatch beside a
		 * category name does. A figure that is a WARNING says so with `color`.
		 */
		wash?: string;
		/** Inside a panel, where the tile is a detail rather than the headline. */
		compact?: boolean;
	} = $props();
</script>

<div
	class="tile"
	class:compact
	style:--wash={wash ? `var(--${wash.replace(/^--/, '')}-wash)` : 'var(--surface)'}
>
	<span class="label">{label}</span>
	<!-- `display`, not `mono`: this is the one class of number the v0.8.1 type
	     rule exempts. Table figures, dates and IDs stay mono — see app.css. -->
	<span class="value display" style:color={color ?? 'var(--fg1)'}>
		{value}{#if unit}<span class="unit">{unit}</span>{/if}
	</span>
	{#if note}<span class="note">{note}</span>{/if}
</div>

<style>
	.tile {
		background: var(--wash);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		padding: var(--space-8) 18px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.tile.compact {
		padding: var(--space-6) var(--space-7);
	}
	.label {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.value {
		font-size: var(--text-4xl);
	}
	.tile.compact .value {
		font-size: var(--display-figure);
	}
	.unit {
		font-size: var(--text-sm);
		font-weight: 400;
		letter-spacing: 0;
		color: var(--fg3);
		margin-left: 5px;
	}
	.note {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	/* The figure is what a tile is for, so it is the last thing to shrink. */
	@media (max-width: 899px) {
		.value {
			font-size: var(--text-3xl);
		}
	}
</style>
