<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
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
		gap: var(--space-6);
		padding: 8px 0;
		border-bottom: 1px solid var(--bd);
	}
	.up-date {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.up-label {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.up-amount {
		font-size: var(--text-md);
	}
</style>
