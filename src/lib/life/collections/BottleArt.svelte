<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The bottle, lying on its side with the cork to the right — matches how a
	 * cellar holds them, and fits a wide card better than a standing bottle would.
	 *
	 * The initials plate and the label photo are both HTML overlaid on the
	 * drawing, not inside it: `assertInertSvg` refuses `<image>`/non-fragment
	 * `href`, so the SVG itself can never carry the photo. See `bottleSvg`.
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
	<!-- Drawing and overlays share the library's own aspect box, so the plate's
	     percentages land correctly at any card width. -->
	<div class="frame" style:aspect-ratio={BOTTLE_ASPECT}>
		{#if art}
			<!-- Checked, not trusted: `assertInertSvg` runs inside `bottleSvg`. -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html art}
		{/if}

		{#if labelPhoto}
			<!-- A label photo is upright but the bottle lies on its side, so the
			     picture is rotated a quarter turn to sit on the glass correctly. -->
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
		/* Height is set by the caller (grid card vs. detail page differ). */
		height: var(--art-height, 132px);
		padding: var(--space-4);
		background: var(--card2);
		color: var(--rose);
		overflow: hidden;
	}
	/* max-width caps the frame so it never overflows the band's height — an
	   aspect-ratio box at width:100% ignores max-height otherwise. */
	.frame {
		position: relative;
		width: 100%;
		max-width: calc((var(--art-height, 132px) - var(--space-6)) * 2.5);
	}
	/* Direct child only — the plate/photo share this box and must not be sized too. */
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
	/* Size container so the rotated image can use the plate's height as its width. */
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
		/* Clockwise so the label's top ends up towards the neck. */
		transform: translate(-50%, -50%) rotate(90deg);
		object-fit: cover;
	}
	.plate {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		/* Label stock — fixed colours regardless of theme (see app.css). */
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
		/* 0.85 not 0.75 — the lower value failed AA contrast at this font size. */
		opacity: 0.85;
	}
</style>
