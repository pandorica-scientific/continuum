<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// The last month each person was paid for, against the month before it.
	//
	// The arrow is drawn here rather than through charts/Delta.svelte because
	// the comparison is already settled: the builder decides whether the month
	// is being read on net or on gross, and hands over the percentage and the
	// colour. Delta.svelte takes the two figures and decides for itself, which
	// would mean the panel making that choice a second time.
	interface Row {
		id: string;
		name: string;
		month: string;
		net: string | null;
		gross: string | null;
		deltaPct: number | null;
		deltaTone: string;
	}

	let { data }: { data: { rows: Row[] } } = $props();

	const arrow = (pct: number | null) => (pct === null || pct === 0 ? '' : pct > 0 ? '▲' : '▼');
	const reading = (row: Row) =>
		row.deltaPct === null
			? 'no month to compare against'
			: row.deltaPct === 0
				? 'unchanged on the month before'
				: `${row.deltaPct > 0 ? 'up' : 'down'} ${Math.abs(row.deltaPct)}% on the month before`;
</script>

<div class="stack">
	{#each data.rows as row (row.id)}
		<div class="row">
			<div class="top">
				<span class="who">{row.name}</span>
				<span class="mono when">{row.month}</span>
			</div>
			<div class="figures">
				<span class="mono net">{row.net ?? '—'}</span>
				<!-- Gross is the second figure, and quiet: what reaches the account
				     is the one a household checks a month against. -->
				<span class="mono gross">{row.gross ? `${row.gross} gross` : ''}</span>
				<span
					class="mono delta"
					role="img"
					aria-label={reading(row)}
					style:color="var({row.deltaTone})"
				>
					{#if row.deltaPct === null}
						—
					{:else}
						{arrow(row.deltaPct)}{arrow(row.deltaPct) ? ' ' : ''}{Math.abs(row.deltaPct)}%
					{/if}
				</span>
			</div>
		</div>
	{:else}
		<span class="quiet">No month has been recorded for anybody yet.</span>
	{/each}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-bottom: 10px;
		border-bottom: 1px solid var(--bd);
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-5);
	}
	.who {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.when {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.figures {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.net {
		font-size: var(--text-lg);
		font-variant-numeric: tabular-nums;
	}
	.gross {
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--fg3);
		margin-right: auto;
	}
	.delta {
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
