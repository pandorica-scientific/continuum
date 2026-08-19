<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	interface Row {
		id: string;
		personName: string;
		year: number;
		country: string;
		gross: string;
		taxPaid: string;
		ratePct: string | null;
	}

	let { data }: { data: { rows: Row[] } } = $props();
</script>

<div class="stack">
	{#each data.rows as row (row.id)}
		<div class="row">
			<div class="top">
				<span class="who">{row.personName}</span>
				<span class="mono when">{row.year} · {row.country}</span>
			</div>
			<div class="figures">
				<span class="mono">{row.gross}</span>
				<span class="mono paid">− {row.taxPaid}</span>
				<span class="mono rate">{row.ratePct ? `${row.ratePct}%` : '—'}</span>
			</div>
		</div>
	{:else}
		<span class="quiet">No tax statement has been recorded yet.</span>
	{/each}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-bottom: 10px;
		border-bottom: 1px solid var(--bd);
	}
	.top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
	}
	.who {
		font-size: 13.5px;
		color: var(--fg2);
	}
	.when {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.figures {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 12.5px;
		flex-wrap: wrap;
	}
	.paid {
		color: var(--red);
	}
	.rate {
		color: var(--fg3);
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
	}
</style>
