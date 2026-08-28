<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	//
	// One shelf in Settings → Shelves: handle, emoji, label, System badge, menu.
	//
	// A new component rather than an extension of a transaction row, which is a
	// data row with no reorder affordance. This is the only sortable row in the
	// app, and the drag state is the whole reason it exists: the dragged row
	// takes `--card3` — the fill the active rail item already uses — and keeps
	// its 1px border. No lift, no shadow, no transition; the system has none.
	import Icon from '$lib/components/Icon.svelte';

	let {
		shelf,
		dragging = false,
		ondragstart,
		ondragover,
		ondrop,
		onrename,
		ondelete
	}: {
		shelf: {
			id: string;
			key: string;
			label: string;
			emoji: string;
			system: boolean;
			count: number;
		};
		dragging?: boolean;
		ondragstart?: () => void;
		ondragover?: () => void;
		ondrop?: () => void;
		onrename?: () => void;
		ondelete?: () => void;
	} = $props();
</script>

<div
	class="shelf-row"
	class:dragging
	draggable="true"
	role="listitem"
	ondragstart={() => ondragstart?.()}
	ondragover={(event) => {
		event.preventDefault();
		ondragover?.();
	}}
	ondrop={(event) => {
		event.preventDefault();
		ondrop?.();
	}}
>
	<span class="handle" aria-hidden="true"><Icon name="grip" size={16} /></span>
	<span class="emoji">{shelf.emoji}</span>
	<button type="button" class="label" onclick={() => onrename?.()}>{shelf.label}</button>
	<span class="mono count">{shelf.count}</span>
	{#if shelf.system}
		<!-- Relabelable, never deletable, key immutable. The badge says which. -->
		<span class="mono badge">System</span>
	{:else}
		<button
			type="button"
			class="menu"
			aria-label="More for {shelf.label}"
			onclick={() => ondelete?.()}
		>
			⋯
		</button>
	{/if}
</div>

<style>
	.shelf-row {
		display: grid;
		grid-template-columns: 28px 36px minmax(0, 1fr) auto 36px;
		align-items: center;
		gap: var(--space-4);
		height: 52px;
		padding: 0 var(--space-5);
		border-bottom: 1px solid var(--bd);
		background: transparent;
	}
	.shelf-row.dragging {
		background: var(--card3);
	}
	.handle {
		color: var(--fg3);
		cursor: grab;
	}
	.emoji {
		font-size: var(--text-md);
		text-align: center;
	}
	.label {
		border: 0;
		background: transparent;
		color: var(--fg1);
		font-size: var(--text-md);
		text-align: left;
		padding: 0;
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		font-size: var(--text-2xs);
		color: var(--fg3);
		font-variant-numeric: tabular-nums;
	}
	.badge {
		font-size: var(--text-2xs);
		font-weight: 600;
		color: var(--fg3);
		background: var(--grey-tint);
		border-radius: var(--radius-xl);
		padding: 2px 8px;
		text-align: center;
	}
	.menu {
		border: 0;
		background: transparent;
		color: var(--fg3);
		font-size: var(--text-md);
		cursor: pointer;
	}
	.menu:hover {
		color: var(--fg1);
	}
</style>
