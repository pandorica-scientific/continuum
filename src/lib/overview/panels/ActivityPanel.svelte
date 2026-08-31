<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	interface Row {
		date: string;
		merchant: string;
		category: string | null;
		amount: string;
		negative: boolean;
	}

	let { data }: { data: { baseCurrency: string; rows: Row[] } } = $props();
</script>

<div class="stack">
	{#each data.rows as row, i (row.date + row.merchant + i)}
		<div class="row">
			<span class="mono date">{row.date}</span>
			<span class="merchant">
				{row.merchant}
				{#if row.category}<span class="cat">{row.category}</span>{/if}
			</span>
			<span class="mono amount" style:color={row.negative ? 'var(--red)' : 'var(--green)'}>
				{row.amount}
			</span>
		</div>
	{:else}
		<span class="quiet">No transactions recorded yet.</span>
	{/each}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: grid;
		grid-template-columns: 42px minmax(0, 1fr) auto;
		align-items: baseline;
		gap: var(--space-5);
		padding: 7px 0;
		border-bottom: 1px solid var(--bd);
	}
	.date {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.merchant {
		font-size: var(--text-md);
		color: var(--fg2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cat {
		font-size: var(--text-xs);
		color: var(--fg3);
		margin-left: 6px;
	}
	.amount {
		font-size: var(--text-sm);
	}
</style>
