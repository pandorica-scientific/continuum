<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import IconTile from '$lib/components/IconTile.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import { BRIEFING_STRIP_SIZE, stripBriefing } from '$lib/briefing';
	import type { Briefing } from '$lib/server/briefing';

	let { data }: { data: Briefing } = $props();

	// The builder ranks everything and hands it all over; the strip is what fits on one row.
	let expanded = $state(false);
	const strip = $derived(stripBriefing(data.items, BRIEFING_STRIP_SIZE, expanded));
</script>

{#if data.items.length}
	<div class="strip">
		<div class="briefing">
			<!-- Keyed by href + title: two documents expiring the same day share a title, and href makes the pair unique. -->
			{#each strip.shown as item (`${item.href}|${item.title}`)}
				<a href={item.href} class="brief-card" style:--brief-hue="var(--{item.hue})">
					<span class="b-top">
						<IconTile hue="--{item.hue}" icon={item.icon} size={30} />
						<span>{item.kind}</span>
						<span class="b-pill"><Pill hue={item.hue}>{item.pill}</Pill></span>
					</span>
					<span class="b-title">{item.title}</span>
					<span class="b-detail">{item.detail}</span>
				</a>
			{/each}
			{#if strip.hidden > 0 || expanded}
				<!-- Takes a card's cell on the row; opening re-lays the panel as a wrapping grid, no inner scroll. -->
				<button
					type="button"
					class="more"
					aria-expanded={expanded}
					aria-label={expanded
						? `Show only the first ${BRIEFING_STRIP_SIZE - 1}`
						: `Show all ${data.total} items — ${data.caption}`}
					onclick={() => (expanded = !expanded)}
				>
					{#if expanded}
						<span class="more-figure display">−</span>
						<span class="more-label">Show fewer</span>
					{:else}
						<span class="more-figure display">+{strip.hidden}</span>
						<span class="more-label">more to decide</span>
					{/if}
				</button>
			{/if}
		</div>
	</div>
{:else}
	<span class="quiet">Nothing needs a decision right now.</span>
{/if}

<style>
	.strip {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	/* auto-fill, not auto-fit: keeps the same column width when an expanded strip adds more cards. */
	.briefing {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		grid-auto-rows: 1fr;
		gap: var(--space-5);
	}
	.more {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		background: var(--surface-2);
		border: 1px dashed var(--bd2);
		border-radius: var(--radius-card);
		color: var(--fg3);
		font: inherit;
		padding: 13px 15px;
		cursor: pointer;
		transition:
			background-color var(--dur) var(--ease),
			transform var(--dur) var(--ease);
	}
	.more:hover {
		background: var(--surface-3);
		color: var(--fg1);
		transform: translateY(-1px);
	}
	.more:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
	.more-figure {
		font-size: var(--text-2xl);
		color: var(--fg1);
	}
	.more-label {
		font-size: var(--text-sm);
	}
	.brief-card {
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 7px;
		background: color-mix(in srgb, var(--brief-hue) 8%, var(--surface));
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		padding: 13px 15px;
		color: var(--fg1);
		transition:
			background-color var(--dur) var(--ease),
			transform var(--dur) var(--ease);
	}
	/* One pixel: enough to answer "is this a link", not enough to jump about. */
	.brief-card:hover {
		background: color-mix(in srgb, var(--brief-hue) 14%, var(--surface));
		transform: translateY(-1px);
		text-decoration: none;
	}
	.b-top {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.b-pill {
		margin-left: auto;
	}
	.b-title {
		font-size: var(--text-lg);
		font-weight: 500;
		line-height: 1.35;
	}
	.b-detail {
		font-size: var(--text-sm);
		color: var(--fg3);
		line-height: 1.5;
	}
</style>
