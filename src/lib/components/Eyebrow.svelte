<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';
	import IconTile from './IconTile.svelte';
	import type { IconName } from '$lib/icons';

	/**
	 * The head of a section: a mark, a name, and a quiet line beside it.
	 *
	 * Named `Eyebrow` for what it used to be — tracked-out capitals above a
	 * card, on every card, on every screen. v0.8.1 keeps the component and its
	 * call sites and changes what it draws: sentence case at panel-title
	 * weight, behind a 26px tile carrying a stroke icon in the section's hue.
	 * Uppercase survives only where it is genuinely a label rather than a
	 * title — a table column head, the hero's "Net worth" — which is what
	 * `.eyebrow` in app.css is still for.
	 *
	 * An icon, never an emoji: the handoff's rule is that emoji survive only
	 * where the household chose them — a shelf, an account — and a 📊 the code
	 * picked for a chart is drawn by the platform, differs per device and
	 * ignores `color`. `design/no-emoji-eyebrow` holds the line.
	 *
	 * A tile rather than a bare glyph so the mark has the same footprint on
	 * every section, including the ones with no icon at all: without it, the
	 * titles on one screen sit at two different left edges.
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
