<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// One line per account: how long since its last statement was read in, and
	// whether that is longer than this account's own rhythm allows. The
	// threshold is per account and lives in $lib/statements/cadence — a current
	// account read weekly and a mortgage account posted quarterly are both up to
	// date, and one number for both would be wrong for one of them.
	import Pill from '$lib/components/Pill.svelte';
	import type { Hue } from '$lib/ui/hue';
	import { readableDate } from '$lib/documents-view';

	interface Row {
		id: string;
		name: string;
		emoji: string;
		bank: string;
		lastOn: string | null;
		daysSince: number | null;
		stale: boolean;
		hue: Hue;
	}

	let { data }: { data: { rows: Row[] } } = $props();

	const since = (days: number | null) =>
		days === null ? '—' : days === 1 ? '1 day' : `${days} days`;
</script>

<div class="stack">
	{#each data.rows as row (row.id)}
		<div class="row">
			<span class="label">{row.emoji} {row.name}</span>
			<span class="mono days">{since(row.daysSince)}</span>
			<span class="sub">
				{row.bank}{row.lastOn ? ` · ${readableDate(row.lastOn)}` : ''}
			</span>
			<!-- A pill only where there is something to say. Every account carrying
			     one would put a row of grey labels beside the two that matter. -->
			{#if row.lastOn === null}
				<span class="state"><Pill hue={row.hue}>never</Pill></span>
			{:else if row.stale}
				<span class="state"><Pill hue={row.hue}>overdue</Pill></span>
			{/if}
		</div>
	{:else}
		<span class="quiet">No account has been added yet.</span>
	{/each}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		gap: var(--space-1) var(--space-5);
		padding: 7px 0;
		border-bottom: 1px solid var(--bd);
	}
	.label {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.days {
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		color: var(--fg1);
		text-align: right;
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.state {
		justify-self: end;
	}
	.quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
