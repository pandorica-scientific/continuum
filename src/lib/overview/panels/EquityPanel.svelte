<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	interface Row {
		id: string;
		name: string;
		value: string;
		owed: string | null;
		equity: string;
		equityPct: number;
	}

	let { data }: { data: { rows: Row[] } } = $props();
</script>

<div class="stack">
	{#each data.rows as row (row.id)}
		<div class="row">
			<span class="label">{row.name}</span>
			<span class="mono figures">
				<span class="owned">{row.equityPct}% yours</span>
				<span>{row.equity}</span>
			</span>
			<div class="track">
				<div class="bar" style:width="{row.equityPct}%"></div>
			</div>
			<span class="detail">
				worth {row.value}{row.owed ? ` · ${row.owed} still owed` : ' · no mortgage'}
			</span>
		</div>
	{:else}
		<span class="quiet">No property recorded yet.</span>
	{/each}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 14px;
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
	.owned {
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
		background: var(--green);
	}
	.detail {
		grid-column: 1 / -1;
		font-size: 11.5px;
		color: var(--fg3);
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
	}
</style>
