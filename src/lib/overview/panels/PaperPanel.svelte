<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Three figures and where the paper sits. The figures are the ones that
	// change what somebody does today — what is unfiled, what is about to lapse,
	// what already has — and the shelves below them are only navigation.
	import { readableDate } from '$lib/documents/view';

	interface Shelf {
		key: string;
		label: string;
		emoji: string;
		count: number;
		href: string;
	}

	let {
		data
	}: {
		data: {
			inbox: number;
			expiring: { soon: number; expired: number; next: string | null };
			shelves: Shelf[];
			lastFiled: string | null;
		};
	} = $props();

	// A zero is not a state, so it stays on the ordinary foreground. Painting
	// "0 expired" red would put the loudest colour on the screen on the one
	// household that has nothing wrong with its paperwork.
	const soonTone = $derived(data.expiring.soon > 0 ? 'var(--yellow)' : 'var(--fg1)');
	const expiredTone = $derived(data.expiring.expired > 0 ? 'var(--red)' : 'var(--fg1)');
</script>

<div class="stack">
	<div class="figures">
		<!-- The only figure with somewhere of its own to go: the review flow is
		     what empties the inbox, and /documents cannot. -->
		<a class="figure" href="/documents?shelf=inbox">
			<span class="mono count">{data.inbox}</span>
			<span class="what">waiting to be filed</span>
		</a>
		<div class="figure">
			<span class="mono count" style:color={soonTone}>{data.expiring.soon}</span>
			<span class="what">
				expiring soon
				{#if data.expiring.next}
					<span class="next">next {readableDate(data.expiring.next)}</span>
				{/if}
			</span>
		</div>
		<div class="figure">
			<span class="mono count" style:color={expiredTone}>{data.expiring.expired}</span>
			<span class="what">already past</span>
		</div>
	</div>

	<div class="shelves">
		{#each data.shelves as shelf (shelf.key)}
			<a class="shelf" href={shelf.href}>
				<span class="label">{shelf.emoji} {shelf.label}</span>
				<span class="mono n">{shelf.count}</span>
			</a>
		{:else}
			<span class="quiet">Nothing is filed on a shelf yet.</span>
		{/each}
	</div>

	{#if data.lastFiled}
		<span class="quiet">Last filed {readableDate(data.lastFiled)}.</span>
	{/if}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.figures {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.figure {
		display: flex;
		align-items: baseline;
		gap: var(--space-5);
		color: var(--fg1);
		padding: 3px 0;
	}
	a.figure:hover {
		text-decoration: none;
		color: var(--fg1);
	}
	a.figure:hover .what {
		color: var(--fg1);
	}
	/* A fixed column so the three counts line up under one another however many
	   digits each has — three figures that do not share an edge read as three
	   unrelated facts. */
	.count {
		font-size: var(--text-2xl);
		font-variant-numeric: tabular-nums;
		min-width: 2.2ch;
		text-align: right;
	}
	.what {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.next {
		font-size: var(--text-xs);
		color: var(--fg3);
		margin-left: var(--space-3);
	}
	.shelves {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--bd);
	}
	.shelf {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-5);
		padding: 6px 0;
		border-bottom: 1px solid var(--bd);
		color: var(--fg2);
	}
	.shelf:hover {
		text-decoration: none;
		color: var(--fg1);
	}
	.label {
		font-size: var(--text-md);
	}
	.n {
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		color: var(--fg3);
	}
</style>
