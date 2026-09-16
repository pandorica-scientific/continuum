<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';
	import IconTile from './IconTile.svelte';
	import type { IconName } from '$lib/icons';

	/**
	 * The head of a section: an icon tile, a name, and a quiet line beside it.
	 *
	 * An icon, never an emoji — emoji survive only where the household chose
	 * them (a shelf, an account); a code-picked emoji renders inconsistently
	 * across platforms and ignores `color`. `design/no-emoji-eyebrow` enforces it.
	 *
	 * Always a tile, even with no icon, so section titles share one left edge.
	 */
	let {
		icon,
		label,
		caption,
		/** A palette token whose wash grounds the tile. */
		hue = '--fg3',
		right
	}: {
		icon?: IconName;
		label: string;
		caption?: string;
		hue?: string;
		right?: Snippet;
	} = $props();
</script>

<div class="eyebrow-row">
	<span class="head">
		{#if icon}
			<IconTile {hue} {icon} size={26} />
		{/if}
		<span class="title">{label}</span>
	</span>
	<!-- Both, not either: a caption names the window, a `right` snippet holds
	     a control or a legend, and a head can carry the two side by side. -->
	{#if caption}
		<span class="eyebrow-caption">{caption}</span>
	{/if}
	{#if right}
		{@render right()}
	{/if}
</div>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
	}
	.title {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
