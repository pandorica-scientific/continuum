<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * One recipe in the grid. Fixed width in a wrapping grid (same rule as the
	 * idea board): cards never stretch to fill a row. Photo if taken, generated
	 * line drawing otherwise.
	 */
	import TagChips from '$lib/life/cookbook/TagChips.svelte';

	interface Tag {
		id: string;
		name: string;
		series: string;
	}

	let {
		href,
		name,
		emoji,
		description,
		minutes,
		servings,
		photo,
		art,
		tags,
		ink
	}: {
		href: string;
		name: string;
		emoji: string;
		description: string;
		minutes: number | null;
		servings: number;
		photo: string | null;
		/** The line drawing, already `currentColor`. */
		art: string | null;
		tags: Tag[];
		/** The `--series-*` token of the shelf this recipe stands on. */
		ink: string;
	} = $props();
</script>

<!-- The shelf's ink, carried by the whole card (same treatment as the idea
     board's stamp colour). Named `--shelf` rather than `--ink`, which the tag
     chips inside set for themselves per tag. -->
<a class="recipe" {href} style:--shelf={`var(${ink})`}>
	<div class="art">
		{#if photo}
			<img src="/files/{photo}" alt="" loading="lazy" />
		{:else if art}
			<!-- Checked, not trusted: `assertInertSvg` runs inside `dishSvg`. -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html art}
		{:else}
			<span class="fallback" aria-hidden="true">{emoji || '🍽️'}</span>
		{/if}
	</div>

	<div class="body">
		<h3>
			{#if emoji}<span class="emoji" aria-hidden="true">{emoji}</span>{/if}
			<span class="name">{name}</span>
		</h3>
		{#if description}<p class="note">{description}</p>{/if}

		<div class="facts">
			{#if minutes}<span><span class="mono">{minutes}</span> min</span>{/if}
			<span><span class="mono">{servings}</span> servings</span>
		</div>

		<TagChips {tags} />
	</div>
</a>

<style>
	/* 6% fill, same as an idea on the trip board — the description below is
	   body text and must clear AA, so the border carries the colour instead. */
	.recipe {
		display: flex;
		flex-direction: column;
		width: 268px;
		height: 100%;
		border: 1px solid color-mix(in srgb, var(--shelf) 45%, var(--bd2));
		border-radius: var(--radius-card);
		background: color-mix(in srgb, var(--shelf) 6%, var(--surface-2));
		box-shadow: var(--shadow-card);
		overflow: hidden;
		color: inherit;
	}
	.recipe:hover {
		text-decoration: none;
		background: color-mix(in srgb, var(--shelf) 12%, var(--surface-2));
	}
	/* No background of its own — the card already wears this ink. */
	.art {
		height: 148px;
		display: grid;
		place-items: center;
		color: var(--shelf);
	}
	.art :global(svg) {
		width: 96px;
		height: 96px;
	}
	.art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.fallback {
		font-size: var(--text-4xl);
		opacity: 0.55;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-6) 14px 14px;
		flex: 1;
	}
	h3 {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
	}
	.emoji {
		flex: none;
	}
	.name {
		min-width: 0;
	}
	.note {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.facts {
		display: flex;
		gap: var(--space-5);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* Chips pinned to the foot so a row of cards aligns its last line. */
	.body :global(.chips) {
		margin-top: auto;
		padding-top: var(--space-4);
	}
</style>
