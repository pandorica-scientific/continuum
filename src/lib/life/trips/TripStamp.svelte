<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * A trip that has been taken, as a stamp in a passport.
	 *
	 * Two states and no third. Where artwork exists the SVG **is** the whole
	 * stamp — no frame around it, no country code repeated beside it, because
	 * the drawing already carries both.
	 *
	 * Where it does not, the same 138px footprint holds a dashed outline and the
	 * words "no stamp yet". That is deliberate: an art-less trip reads as
	 * pending rather than as a second kind of card, and the wall stays a grid.
	 *
	 * The ink is the destination country's colour — the same value that country
	 * wears on the map. Never assigned by position in the row.
	 */
	let {
		href,
		name,
		month,
		emoji,
		art
	}: {
		href: string;
		name: string;
		/** "June 2026" — printed in mono under the name. */
		month: string;
		emoji: string;
		art: { svg: string; hue: string | null } | null;
	} = $props();
</script>

<a class="stamp" {href}>
	<div
		class="mark"
		class:pending={!art}
		style:color={art?.hue ? `var(--${art.hue})` : 'var(--fg3)'}
	>
		{#if art}
			<!-- The one `{@html}` in this product, and it is checked rather than
			     trusted: `assertInertSvg` in $lib/life/art refuses any drawing
			     carrying a script, a handler or an external reference, and the
			     household's own trip name is the only non-machine part of it. -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html art.svg}
		{:else}
			<span class="emoji" aria-hidden="true">{emoji || '🧳'}</span>
			<span class="pending-label mono">no stamp yet</span>
		{/if}
	</div>
	<span class="name">{name}</span>
	<span class="month mono">{month}</span>
</a>

<style>
	.stamp {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		width: 138px;
		color: inherit;
	}
	.stamp:hover {
		text-decoration: none;
	}
	.stamp:hover .name {
		color: var(--fg1);
	}
	.mark {
		width: 138px;
		height: 138px;
		display: grid;
		place-items: center;
	}
	.mark :global(svg) {
		width: 100%;
		height: 100%;
	}
	/* Dashed, in the country's own hue mixed towards the ordinary border: it
	   reads as a space waiting for a stamp, not as a card that failed. */
	.pending {
		flex-direction: column;
		gap: var(--space-3);
		border: 1px dashed color-mix(in srgb, currentColor 45%, var(--bd2));
		border-radius: var(--radius-card);
		background: transparent;
	}
	.emoji {
		font-size: 26px;
		opacity: 0.55;
	}
	.pending-label {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.name {
		font-size: var(--text-md);
		color: var(--fg2);
		text-align: center;
		line-height: 1.3;
	}
	.month {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
</style>
