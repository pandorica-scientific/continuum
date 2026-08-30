<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// What is still owed, loan by loan, with the fixation pill the Loans screen
	// draws — from the same function, so the two cannot disagree about when a
	// rate stops being settled.
	import Pill from '$lib/components/Pill.svelte';
	import type { Hue } from '$lib/ui/hue';

	interface Row {
		id: string;
		name: string;
		owed: string;
		ratePct: string | null;
		payment: string | null;
		fixationEnd: string;
		hue: Hue;
		href: string;
	}

	let { data }: { data: { rows: Row[]; totalOwed: string } } = $props();
</script>

<div class="stack">
	{#each data.rows as row (row.id)}
		<a class="row" href={row.href}>
			<span class="name">{row.name}</span>
			<span class="mono owed">{row.owed}</span>
			<span class="mono terms">
				{row.ratePct ? `${row.ratePct}%` : '—'}
				{#if row.payment}
					· {row.payment} a month
				{/if}
			</span>
			<span class="state"><Pill hue={row.hue}>{row.fixationEnd}</Pill></span>
		</a>
	{:else}
		<span class="quiet">Nothing is owed.</span>
	{/each}
	<!-- A total of nothing under a line saying nothing is owed is the same fact
	     twice, and the rule above it draws a section with no rows in it. -->
	{#if data.rows.length}
		<div class="total">
			<span class="name">Total owed</span>
			<span class="mono">{data.totalOwed}</span>
		</div>
	{/if}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		gap: var(--space-2) var(--space-5);
		color: var(--fg2);
	}
	.row:hover {
		text-decoration: none;
		color: var(--fg1);
	}
	.name {
		font-size: var(--text-md);
	}
	.owed {
		font-size: var(--text-md);
		font-variant-numeric: tabular-nums;
		color: var(--red);
	}
	.terms {
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--fg3);
	}
	.state {
		justify-self: end;
	}
	.total {
		display: flex;
		justify-content: space-between;
		border-top: 1px solid var(--bd);
		padding-top: 12px;
		font-size: var(--text-md);
		font-weight: 600;
	}
	.quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
