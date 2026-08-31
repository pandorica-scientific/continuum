<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	let {
		label,
		value,
		unit,
		note,
		color
	}: { label: string; value: string; unit?: string; note?: string; color?: string } = $props();
</script>

<div class="tile">
	<span class="label">{label}</span>
	<span class="value mono" style:color={color ?? 'var(--fg1)'}>
		{value}{#if unit}<span class="unit">{unit}</span>{/if}
	</span>
	{#if note}<span class="note">{note}</span>{/if}
</div>

<style>
	.tile {
		background: var(--card);
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.label {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.value {
		font-size: var(--text-2xl);
		font-weight: 600;
		white-space: nowrap;
	}
	.unit {
		font-size: var(--text-sm);
		color: var(--fg3);
		margin-left: 5px;
	}
	.note {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
</style>
