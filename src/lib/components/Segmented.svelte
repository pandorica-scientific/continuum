<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
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
		gap: var(--space-1);
		border: 1px solid var(--bd);
		border-radius: var(--radius-ctl);
		padding: 3px;
		background: var(--card);
	}
	button {
		border: 0;
		background: transparent;
		color: var(--fg3);
		border-radius: var(--radius-md);
		padding: 5px var(--space-6);
		font-size: var(--text-sm);
		font-family: inherit;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background-color var(--dur) var(--ease),
			color var(--dur) var(--ease);
	}
	/* A lifted surface rather than a darker card: the segment that is chosen
	   should read as raised out of the track, which is the one thing that tells
	   a segmented control apart from a row of chips. */
	button.active {
		background: var(--surface-3);
		color: var(--fg1);
		font-weight: 600;
	}
	button:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
</style>
