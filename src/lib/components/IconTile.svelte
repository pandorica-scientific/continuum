<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import Icon from './Icon.svelte';
	import type { IconName } from '$lib/icons';

	/**
	 * A hue mixed into the ground behind a stroke icon or an emoji.
	 *
	 * Radius is derived from size, not a prop — leaving it free would let
	 * callers pick a wrong combination like 26px at radius 14.
	 */
	interface Props {
		/** A palette token name, with or without the leading dashes: `teal`, `--teal`. */
		hue?: string;
		/** Edge length in px. 26 panel title · 30 row · 44 card · 46 screen title. */
		size?: number;
		icon?: IconName;
		/** Data-level identity — an account's, a shelf's, a module's. Wins over `icon`. */
		emoji?: string;
		/**
		 * A bank's logo, which wins over both.
		 *
		 * Drawn on a light chip rather than the hue: half these marks are black
		 * on transparent, and on a dark ground they disappear.
		 */
		logo?: string | null;
		/** The stronger mix, for a selected nav row or an active tab. */
		active?: boolean;
		/** Decoration beside a name that already says it. */
		label?: string;
	}

	let {
		hue = '--fg3',
		size = 30,
		icon,
		emoji,
		logo = null,
		active = false,
		label
	}: Props = $props();

	const token = $derived(hue.startsWith('--') ? hue : `--${hue}`);

	// Steps rather than a ratio, matching the named radius tokens (8/10/12);
	// above 40px falls back to explicit values.
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

	// An icon fills a little over half its tile at every size in use.
	const glyph = $derived(Math.round(size * 0.52));
</script>

<span
	class="tile"
	class:has-logo={logo}
	class:active
	style:--tile-hue="var({token})"
	style:--tile-size="{size}px"
	style:--tile-radius={radius}
	style:--glyph="{glyph}px"
	aria-hidden={label ? undefined : 'true'}
	aria-label={label}
	role={label ? 'img' : undefined}
>
	{#if logo}
		<!-- Decorative: the name it sits beside already says which bank. -->
		<img src={logo} alt="" class="logo" loading="lazy" />
	{:else if emoji}
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
		/* Never squeezed by the flexible column beside it. */
		flex: none;
		transition: background-color var(--dur) var(--ease);
	}
	/* A mark on light, whatever the theme — see the `logo` prop. */
	.tile.has-logo {
		background: #f4f5f7;
	}
	/* Whole rather than cropped: a bank mark is a fixed shape, and most are
	   wide wordmarks, so the width leads and the height follows. */
	.logo {
		width: calc(var(--tile-size) * 0.8);
		height: calc(var(--tile-size) * 0.8);
		object-fit: contain;
	}
	.tile.active {
		background: color-mix(in srgb, var(--tile-hue) var(--tile-alpha-active), transparent);
	}
	/* An emoji ignores `color`, so it's only sized to match an icon's footprint. */
	.emoji {
		font-size: calc(var(--glyph) * 1.05);
		line-height: 1;
	}
</style>
