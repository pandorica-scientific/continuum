<script lang="ts">
	interface Event {
		date: string;
		label: string;
		amount: string | null;
		negative: boolean;
	}

	let { data }: { data: Event[] } = $props();
</script>

<div class="stack">
	{#each data as u (u.date + u.label)}
		<div class="up-row">
			<span class="mono up-date">{u.date}</span>
			<span class="up-label">{u.label}</span>
			<span class="mono up-amount" style:color={u.negative ? 'var(--red)' : 'var(--green)'}>
				{u.amount ?? ''}
			</span>
		</div>
	{:else}
		<span class="quiet">Nothing on the books for the next month.</span>
	{/each}
	<a href="/calendar" class="open-link">Open calendar →</a>
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
	}
	.up-row {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--bd);
	}
	.up-date {
		font-size: 12px;
		color: var(--fg3);
	}
	.up-label {
		font-size: 13.5px;
		color: var(--fg2);
	}
	.up-amount {
		font-size: 13px;
	}
	.open-link {
		font-size: 12.5px;
		padding-top: 10px;
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
	}
</style>
