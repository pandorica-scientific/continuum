<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The type filter above the bottle grid.
	 *
	 * Chips are derived from the rows that exist — see `types.ts` — so a chip
	 * never leads to an empty screen. Beyond four the rest sit behind a dashed
	 * `+n` that expands in place.
	 */
	import { splitChips, type TypeChip } from '$lib/life/collections/types';
	import type { EnumValue } from '$lib/enums';

	let {
		chips,
		selected,
		onselect
	}: {
		chips: TypeChip[];
		selected: EnumValue<'bottle.type'> | null;
		onselect: (type: EnumValue<'bottle.type'> | null) => void;
	} = $props();

	let expanded = $state(false);

	const split = $derived(splitChips(chips));
	// A hidden chip that is currently filtering on would otherwise vanish along
	// with the way to turn it off.
	const showAll = $derived(expanded || split.hidden.some((chip) => chip.type === selected));
	const visible = $derived(showAll ? chips : split.shown);
</script>

{#if chips.length}
	<div class="chips" role="group" aria-label="Filter by type">
		{#each visible as chip (chip.type)}
			<button
				class="chip"
				class:on={selected === chip.type}
				type="button"
				aria-pressed={selected === chip.type}
				onclick={() => onselect(selected === chip.type ? null : chip.type)}
			>
				{chip.label} <span class="count mono">{chip.count}</span>
			</button>
		{/each}

		{#if split.hidden.length && !showAll}
			<button class="chip more" type="button" onclick={() => (expanded = true)}>
				+{split.hidden.length}
			</button>
		{/if}
	</div>
{/if}

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.chip {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-3);
		min-height: auto;
		padding: var(--space-2) var(--space-5);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		background: none;
		color: var(--fg2);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.chip:hover {
		border-color: color-mix(in srgb, var(--rose) 55%, transparent);
		color: var(--fg1);
	}
	.chip.on {
		background: var(--rose-tint);
		border-color: color-mix(in srgb, var(--rose) 55%, transparent);
		color: var(--rose);
	}
	.count {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.chip.on .count {
		color: inherit;
	}
	.more {
		border-style: dashed;
		color: var(--fg3);
	}
</style>
