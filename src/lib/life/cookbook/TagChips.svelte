<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * A recipe's tags, each in its own colour.
	 *
	 * Not `Pill`: a pill is the traffic light and its hues mean state. A tag is
	 * an identity, so it takes a `--series-*` colour — and its ink is darkened
	 * by `--series-ink-mix`, because the series values are tuned for a bar chart
	 * and are too light for eleven-pixel text on paper.
	 *
	 * Where a card holds more tags than fit, a `+n` chip carries the rest rather
	 * than the row growing a second line on some cards and not others.
	 */
	interface Tag {
		id: string;
		name: string;
		series: string;
	}

	let {
		tags,
		/** How many to draw before the rest collapse. */
		limit = 3
	}: { tags: Tag[]; limit?: number } = $props();

	let expanded = $state(false);
	const shown = $derived(expanded ? tags : tags.slice(0, limit));
	const hidden = $derived(Math.max(0, tags.length - shown.length));
</script>

{#if tags.length}
	<div class="chips">
		{#each shown as tag (tag.id)}
			<span class="chip" style:--ink="var(--{tag.series})">{tag.name}</span>
		{/each}
		{#if hidden > 0}
			<button
				class="chip more"
				type="button"
				onclick={(event) => {
					// The card is a link; showing the rest is not navigating to it.
					event.preventDefault();
					event.stopPropagation();
					expanded = true;
				}}
			>
				+{hidden}
			</button>
		{/if}
	</div>
{/if}

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	/* 15% fill, 40% border, ink darkened towards the foreground — the treatment
	   the handoff sets for tags, and the same one the tasting notes use. */
	.chip {
		display: inline-flex;
		align-items: center;
		padding: 2px var(--space-4);
		border: 1px solid color-mix(in srgb, var(--ink) 40%, transparent);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--ink) 15%, transparent);
		color: color-mix(in srgb, var(--ink) 68%, var(--fg1));
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.more {
		min-height: auto;
		--ink: var(--fg3);
		border-style: dashed;
		background: none;
		cursor: pointer;
	}
	.more:hover {
		color: var(--fg1);
	}
</style>
