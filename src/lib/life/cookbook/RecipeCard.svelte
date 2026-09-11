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
		tags
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
	} = $props();
</script>

<a class="recipe" {href}>
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
	.recipe {
		display: flex;
		flex-direction: column;
		width: 268px;
		height: 100%;
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--card);
		overflow: hidden;
		color: inherit;
	}
	.recipe:hover {
		text-decoration: none;
		background: var(--surface-2);
	}
	.art {
		height: 148px;
		display: grid;
		place-items: center;
		background: var(--card2);
		color: var(--rose);
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
