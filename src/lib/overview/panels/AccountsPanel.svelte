<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	interface Row {
		id: string;
		name: string;
		emoji: string;
		value: string;
		pct: number;
		width: number;
		colorVar: string;
	}

	let { data }: { data: { total: string; rows: Row[] } } = $props();
</script>

<div class="stack">
	{#each data.rows as row (row.id)}
		<div class="row">
			<span class="label">{row.emoji} {row.name}</span>
			<span class="mono figures">
				<span class="pct">{row.pct}%</span>
				<span>{row.value}</span>
			</span>
			<div class="track">
				<div class="bar" style:width="{row.width}%" style:background="var({row.colorVar})"></div>
			</div>
		</div>
	{:else}
		<span class="quiet">No account holds a positive balance.</span>
	{/each}
	<div class="total">
		<span class="label">Total cash</span>
		<span class="mono">{data.total}</span>
	</div>
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
		gap: var(--space-2) var(--space-6);
	}
	.label {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.figures {
		font-size: var(--text-sm);
		display: flex;
		gap: var(--space-5);
	}
	.pct {
		color: var(--fg3);
	}
	.track {
		grid-column: 1 / -1;
		height: 6px;
		background: var(--card3);
		border-radius: var(--radius-xs);
		overflow: hidden;
	}
	.bar {
		height: 100%;
		border-radius: var(--radius-xs);
	}
	.total {
		display: flex;
		justify-content: space-between;
		border-top: 1px solid var(--bd);
		padding-top: 12px;
		font-size: var(--text-md);
		font-weight: 600;
	}
</style>
