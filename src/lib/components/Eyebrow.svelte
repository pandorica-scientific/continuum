<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';

	/**
	 * The head of a section: a mark, a name, and a quiet line beside it.
	 *
	 * Named `Eyebrow` for what it used to be — tracked-out capitals above a
	 * card, on every card, on every screen. v0.8.1 keeps the component and its
	 * sixteen call sites and changes what it draws: sentence case at panel-title
	 * weight, behind a 26px tile carrying the section's own emoji. Uppercase
	 * survives only where it is genuinely a label rather than a title — a table
	 * column head, the hero's "Net worth" — which is what `.eyebrow` in app.css
	 * is still for.
	 *
	 * A tile rather than a bare glyph so the mark has the same footprint on
	 * every section, including the ones with no emoji at all: without it, the
	 * titles on one screen sit at two different left edges.
	 */
	let {
		emoji,
		label,
		caption,
		/** A palette token whose wash grounds the tile. */
		hue = '--fg3',
		right
	}: {
		emoji?: string;
		label: string;
		caption?: string;
		hue?: string;
		right?: Snippet;
	} = $props();
</script>

<div class="eyebrow-row">
	<span class="head">
		{#if emoji}
			<span class="mark" style:--head-hue="var({hue})" aria-hidden="true">{emoji}</span>
		{/if}
		<span class="title">{label}</span>
	</span>
	{#if right}
		{@render right()}
	{:else if caption}
		<span class="eyebrow-caption">{caption}</span>
	{/if}
</div>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
	}
	.mark {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--head-hue) var(--tile-alpha), transparent);
		font-size: var(--text-md);
		line-height: 1;
		flex: none;
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
