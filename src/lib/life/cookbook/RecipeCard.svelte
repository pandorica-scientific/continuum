<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * One recipe in the grid.
	 *
	 * Fixed width in a wrapping grid, the same rule as the idea board: cards
	 * never stretch to fill a row, extras wrap. A photograph where the household
	 * has taken one, the generated line drawing where it has not.
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

<!--
	The shelf's ink, carried by the whole card — the same treatment the idea board
	uses for a stamp's colour. A cookbook is read by shelf, so a grid showing
	everything at once is a grid where the shelf a recipe belongs to is the first
	thing worth seeing, and colour says it without a label on every card.

	Carried as `--shelf` rather than `--ink`, which the tag chips inside set for
	themselves per tag: one name meaning two things on the same element is a trap
	even where it happens to work.
-->
<a class="recipe" {href} style:--shelf={`var(${ink})`}>
	<div class="art">
		{#if photo}
			<img src="/files/{photo}" alt="" loading="lazy" />
		{:else if art}
			<!-- Checked, not trusted: `assertInertSvg` runs inside `dishSvg` and
			     refuses a drawing carrying a script, a handler or an external
			     reference. See $lib/life/art. -->
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
	/* The same raised, inked box as an idea on the trip board, and kept to 6% for
	   the same reason: the description under the title is ordinary body text and
	   has to clear AA on it, so the border carries the colour instead. */
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
	/* No ground of its own: the card is already wearing this ink, and a panel
	   behind the drawing cut the card into two halves. A photograph still fills
	   the whole of it, which is why the height stays. */
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
	/* The chips sit at the foot whatever the description's length, so a row of
	   cards agrees about where its last line is. */
	.body :global(.chips) {
		margin-top: auto;
		padding-top: var(--space-4);
	}
</style>
