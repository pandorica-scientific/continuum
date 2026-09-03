<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import Icon from './Icon.svelte';
	import type { IconName } from '$lib/icons';

	/**
	 * A hue mixed into the ground behind a stroke icon or an emoji.
	 *
	 * v0.8.1's single most repeated shape: it precedes a screen title, a panel
	 * title, an account row, a card head and a nav row, at five sizes and in
	 * every hue the palette has. Written once because the alternative was the
	 * `.tiles` story again — the same 30px rounded square declared in forty
	 * component stylesheets, drifting a pixel of radius at a time.
	 *
	 * The ONE number this owns that the caller does not is the radius. It is a
	 * function of the size and not a prop, because a 26px tile at radius 14 and
	 * a 46px tile at radius 8 are both wrong, and a caller choosing freely will
	 * eventually pick one of them.
	 */
	interface Props {
		/** A palette token name, with or without the leading dashes: `teal`, `--teal`. */
		hue?: string;
		/** Edge length in px. 26 panel title · 30 row · 44 card · 46 screen title. */
		size?: number;
		icon?: IconName;
		/** Data-level identity — an account's, a shelf's, a module's. Wins over `icon`. */
		emoji?: string;
		/** The stronger mix, for a selected nav row or an active tab. */
		active?: boolean;
		/** Decoration beside a name that already says it. */
		label?: string;
	}

	let { hue = '--fg3', size = 30, icon, emoji, active = false, label }: Props = $props();

	const token = $derived(hue.startsWith('--') ? hue : `--${hue}`);

	// Steps rather than a ratio: the scale has names for 8, 10 and 12, and a
	// computed 8.4px would be a raw value beside the token that means the same
	// thing. Above 40px the scale stops and the design's own numbers take over.
	const radius = $derived(
		size <= 26
			? 'var(--radius-md)'
			: size <= 32
				? '9px'
				: size <= 40
					? 'var(--radius-xl)'
					: size <= 44
						? '13px'
						: '14px'
	);

	// An icon fills a little over half its tile at every size the design uses:
	// 14 in 26, 16 in 30, 22 in 44, 24 in 46.
	const glyph = $derived(Math.round(size * 0.52));
</script>

<span
	class="tile"
	class:active
	style:--tile-hue="var({token})"
	style:--tile-size="{size}px"
	style:--tile-radius={radius}
	style:--glyph="{glyph}px"
	aria-hidden={label ? undefined : 'true'}
	aria-label={label}
	role={label ? 'img' : undefined}
>
	{#if emoji}
		<span class="emoji">{emoji}</span>
	{:else if icon}
		<Icon name={icon} size={glyph} />
	{/if}
</span>

<style>
	.tile {
		display: grid;
		place-items: center;
		width: var(--tile-size);
		height: var(--tile-size);
		border-radius: var(--tile-radius);
		background: color-mix(in srgb, var(--tile-hue) var(--tile-alpha), transparent);
		color: var(--tile-hue);
		/* Never squeezed by the flexible column beside it: a tile that has lost
		   two pixels reads as a different tile, and the name next to it has an
		   ellipsis for exactly this. */
		flex: none;
		transition: background-color var(--dur) var(--ease);
	}
	.tile.active {
		background: color-mix(in srgb, var(--tile-hue) var(--tile-alpha-active), transparent);
	}
	/* An emoji is drawn by the platform and ignores `color`; it only needs to be
	   sized to sit in the tile the way an icon does. */
	.emoji {
		font-size: calc(var(--glyph) * 1.05);
		line-height: 1;
	}
</style>
