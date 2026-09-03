<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import IconTile from '$lib/components/IconTile.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import { BRIEFING_STRIP_SIZE } from '$lib/briefing';
	// The shape the builder produces, not a second copy of it: a source that
	// gains a field should not need this component edited to keep up.
	import type { Briefing } from '$lib/server/briefing';

	let { data }: { data: Briefing } = $props();

	// The builder ranks everything and hands it all over; the strip is what fits
	// on one row. The rest used to be dropped on the server, which meant a ninth
	// thing that needed somebody was a thing nobody could reach.
	let expanded = $state(false);
	const shown = $derived(expanded ? data.items : data.items.slice(0, BRIEFING_STRIP_SIZE));
</script>

{#if data.items.length}
	<div class="strip">
		<div class="briefing">
			<!-- Keyed by where it leads as well as by what it says: two documents
			     expiring on the same day carry the same title, and a duplicate key
			     is a thrown render rather than a muddled list. The href names the
			     record behind the card, so the pair is unique. -->
			{#each shown as item (`${item.href}|${item.title}`)}
				<!-- Grounded in the pill's own hue, so what kind of decision this is
				     is legible before the words are: a red card is an expiry, an
				     amber one something waiting. -->
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
		</div>
		{#if data.total > BRIEFING_STRIP_SIZE}
			<!--
				"+3" says how many are behind the button but not what they are, and a
				screen reader reaches it with the caption already read out several
				headings ago — so the label restates it here.
			-->
			<button
				type="button"
				class="more"
				aria-expanded={expanded}
				aria-label={expanded
					? `Show only the first ${BRIEFING_STRIP_SIZE}`
					: `Show all ${data.total} items — ${data.caption}`}
				onclick={() => (expanded = !expanded)}
			>
				{#if expanded}
					Show fewer
				{:else}
					<span class="mono">+{data.total - BRIEFING_STRIP_SIZE}</span> more
				{/if}
			</button>
		{/if}
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
	.briefing {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: var(--space-5);
	}
	/* Quiet, and only as wide as its own words: it is a way through to the rest,
	   not a fifth card competing with the four above it. */
	.more {
		align-self: flex-start;
		background: none;
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		color: var(--fg3);
		font-size: var(--text-sm);
		padding: 5px 10px;
		cursor: pointer;
	}
	.more:hover {
		background: var(--card2);
		color: var(--fg1);
	}
	.more:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
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
	/* A card that opens something lifts. One pixel: enough to answer "is this a
	   link", not enough to make four of them jump about as the pointer crosses. */
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
