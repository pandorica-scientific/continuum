<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	interface Option {
		value: string;
		label: string;
	}

	let {
		options,
		value = $bindable(),
		onchange
	}: { options: Option[]; value: string; onchange?: (value: string) => void } = $props();
</script>

<div class="segmented">
	{#each options as option (option.value)}
		<button
			type="button"
			class:active={value === option.value}
			onclick={() => {
				value = option.value;
				onchange?.(option.value);
			}}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.segmented {
		display: flex;
		gap: 6px;
		border: 1px solid var(--bd);
		border-radius: 8px;
		padding: 3px;
		background: var(--card);
	}
	button {
		border: 0;
		background: transparent;
		color: var(--fg3);
		border-radius: 6px;
		padding: 6px 13px;
		font-size: 12.5px;
		cursor: pointer;
	}
	button.active {
		background: var(--card3);
		color: var(--fg1);
	}
</style>
