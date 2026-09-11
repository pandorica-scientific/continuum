<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The bottle, lying on its side with the cork to the right.
	 *
	 * On its side because that is how a cellar holds them and because a card is
	 * wider than it is tall — a standing bottle in a 268px card is a 40px-wide
	 * sliver with empty air either side.
	 *
	 * The plate carries the producer's initials until somebody photographs the
	 * real label, and then the photograph takes its place. BOTH are HTML over the
	 * drawing rather than inside it: the SVG goes through `assertInertSvg`, which
	 * refuses `<image>` and any non-fragment `href`, so a photograph put into the
	 * drawing threw and the card rendered nothing. See `bottleSvg`.
	 */
	import { BOTTLE_ASPECT, bottleLabelBox } from '$lib/life/art';
	import type { EnumValue } from '$lib/enums';

	interface Props {
		/** The silhouette, already `currentColor`. Null if it cannot be drawn. */
		art: string | null;
		type: EnumValue<'bottle.type'>;
		initials: string;
		vintage: number | null;
		labelPhoto: string | null;
		/** What the photograph is of, for anybody who cannot see it. */
		name: string;
	}

	let { art, type, initials, vintage, labelPhoto, name }: Props = $props();

	const box = $derived(bottleLabelBox(type));
</script>

<div class="art">
	<!-- The drawing and its overlays share one box of the library's own aspect,
	     so the plate's percentages land where the plate is however wide the card
	     turns out to be. -->
	<div class="frame" style:aspect-ratio={BOTTLE_ASPECT}>
		{#if art}
			<!-- Checked, not trusted: `assertInertSvg` runs inside `bottleSvg` and
			     refuses a drawing carrying a script, a handler or an external
			     reference. See $lib/life/art. -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html art}
		{/if}

		{#if labelPhoto}
			<!-- A label is photographed the way it is read — upright — and the
			     bottle here is lying down. So the picture is turned a quarter turn
			     to sit on the glass the way the real label does, top edge towards
			     the neck. Only the picture turns; the drawing does not. -->
			<span
				class="label"
				style:left={box.left}
				style:top={box.top}
				style:width={box.width}
				style:height={box.height}
			>
				<img src="/files/{labelPhoto}" alt="The label on {name}" loading="lazy" />
			</span>
		{:else if initials || vintage}
			<span
				class="plate"
				aria-hidden="true"
				style:left={box.left}
				style:top={box.top}
				style:width={box.width}
				style:height={box.height}
			>
				{#if initials}<span class="initials">{initials}</span>{/if}
				{#if vintage}<span class="vintage mono">{vintage}</span>{/if}
			</span>
		{/if}
	</div>
</div>

<style>
	.art {
		display: grid;
		place-items: center;
		/* The band's height is the caller's to set; the drawing is fitted into it.
		   A grid card wants a short strip, the detail page a taller one. */
		height: var(--art-height, 132px);
		padding: var(--space-4);
		background: var(--card2);
		color: var(--rose);
		overflow: hidden;
	}
	/* Width-driven until the drawing would be taller than the band, then
	   height-driven. An `aspect-ratio` box given `width: 100%` ignores a
	   `max-height` and simply overflows — which is what it did. */
	.frame {
		position: relative;
		width: 100%;
		max-width: calc((var(--art-height, 132px) - var(--space-6)) * 2.5);
	}
	/* The direct child only: the plate and the photograph sit in the same box,
	   and an unscoped rule would size those too. */
	.frame > :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}
	.label,
	.plate {
		position: absolute;
		border-radius: 2px;
	}
	/* A size container, so the picture inside can be given the plate's height as
	   its width. Percentages cannot do that — a width in per cent resolves
	   against the width — and the swap is the whole point of a quarter turn. */
	.label {
		container-type: size;
		overflow: hidden;
	}
	.label img {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 100cqh;
		height: 100cqw;
		/* Clockwise, so the top of the label ends up towards the neck — which is
		   how a bottle lying on its side actually reads. */
		transform: translate(-50%, -50%) rotate(90deg);
		/* `cover`, so a photograph of any shape fills the plate rather than
		   leaving bands of paper around a portrait crop. The crop step before it
		   is what makes this the right call. */
		object-fit: cover;
	}
	.plate {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		/* Label stock. The one pair of tokens that does not change with the theme
		   — see app.css: a label is the same colour in a dark cellar as a lit one. */
		background: var(--label-paper);
		color: var(--label-ink);
		line-height: 1.1;
		overflow: hidden;
	}
	.initials {
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
	}
	.vintage {
		font-size: var(--text-2xs);
		opacity: 0.75;
	}
</style>
