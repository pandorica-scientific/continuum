<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Two bars a row: what the month cost, in the group's own colour, over what
	// it usually costs, in the quiet foreground. Paired rather than one bar with
	// a marker on it, because the question is "how far apart are these two", and
	// two lengths side by side answer that without anybody reading a number.
	import { deltaTone } from '$lib/charts/delta';
	import type { BudgetRow } from '$lib/budget';

	let { data }: { data: { month: string | null; unit: string; rows: BudgetRow[] } } = $props();

	const figure = (value: number) => Math.round(value).toLocaleString('en');
</script>

{#if data.rows.length && data.month}
	<div class="stack">
		<span class="caption">{data.month} against the twelve months before it</span>
		{#each data.rows as row (row.key)}
			<div class="row">
				<span class="label">{row.label}</span>
				<!-- Spending more is the bad news here, which is the half of the
				     judgement the percentage on its own cannot carry. -->
				<span class="mono over" style:color="var({deltaTone(row.overPct, false)})">
					{row.overPct === null ? '—' : `${row.overPct > 0 ? '+' : ''}${row.overPct}%`}
				</span>
				<div class="bars">
					<div class="track">
						<div
							class="bar"
							style:width="{row.thisWidth}%"
							style:background="var({row.colorVar})"
						></div>
					</div>
					<div class="track">
						<div class="bar average" style:width="{row.averageWidth}%"></div>
					</div>
				</div>
				<span class="mono figures">
					<span>{figure(row.thisMonth)}</span>
					<span class="usual">usually {figure(row.average)} {data.unit}</span>
				</span>
			</div>
		{/each}
	</div>
{:else}
	<span class="quiet">Not enough spending on record to compare a month against.</span>
{/if}

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.caption {
		font-size: var(--text-xs);
		color: var(--fg3);
		line-height: 1.45;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		gap: var(--space-2) var(--space-5);
	}
	.label {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.over {
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.bars {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.track {
		height: 6px;
		background: var(--card3);
		border-radius: var(--radius-xs);
		overflow: hidden;
	}
	.bar {
		height: 100%;
		border-radius: var(--radius-xs);
	}
	.average {
		background: var(--fg3);
	}
	.figures {
		grid-column: 1 / -1;
		display: flex;
		justify-content: space-between;
		gap: var(--space-5);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}
	.usual {
		color: var(--fg3);
	}
</style>
