<script lang="ts">
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
		gap: 12px;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px 12px;
	}
	.label {
		font-size: 13.5px;
		color: var(--fg2);
	}
	.figures {
		font-size: 12.5px;
		display: flex;
		gap: 10px;
	}
	.pct {
		color: var(--fg3);
	}
	.track {
		grid-column: 1 / -1;
		height: 6px;
		background: var(--card3);
		border-radius: 4px;
		overflow: hidden;
	}
	.bar {
		height: 100%;
		border-radius: 4px;
	}
	.total {
		display: flex;
		justify-content: space-between;
		border-top: 1px solid var(--bd);
		padding-top: 12px;
		font-size: 13px;
		font-weight: 600;
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
	}
</style>
