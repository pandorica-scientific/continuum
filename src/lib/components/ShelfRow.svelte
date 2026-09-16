<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The only sortable row in the app: dragging takes `--card3` and keeps its
	// 1px border. No lift, no shadow, no transition.
	import Icon from '$lib/components/Icon.svelte';

	let {
		shelf,
		dragging = false,
		ondragstart,
		ondragover,
		ondrop,
		onrename,
		ontypes,
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
		/** Which types this shelf offers first. Every shelf has a list, system or not. */
		ontypes?: () => void;
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
	<span class="handle" aria-hidden="true"><Icon name="grip" size={14} /></span>
	<span class="emoji">{shelf.emoji}</span>
	<button type="button" class="label" onclick={() => onrename?.()}>{shelf.label}</button>
	<span class="mono count">{shelf.count}</span>
	<span class="tail">
		<!-- Offered on a system shelf too: not deletable, but still reorderable by type. -->
		<button
			type="button"
			class="menu types"
			aria-label="Types for {shelf.label}"
			title="Which types this shelf offers first"
			onclick={() => ontypes?.()}
		>
			<Icon name="tag" size={13} />
		</button>
		{#if shelf.system}
			<span class="mono badge">System</span>
		{:else}
			<button
				type="button"
				class="menu"
				aria-label="More for {shelf.label}"
				onclick={() => ondelete?.()}>⋯</button
			>
		{/if}
	</span>
</div>

<style>
	.shelf-row {
		display: grid;
		/* Sized for the 218px rail's edit mode it lives in. */
		grid-template-columns: 18px 26px minmax(0, 1fr) auto minmax(24px, auto);
		align-items: center;
		gap: var(--space-3);
		height: 36px;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		border: 1px solid transparent;
		background: transparent;
	}
	.shelf-row:hover {
		background: var(--card2);
	}
	.shelf-row.dragging {
		background: var(--card3);
		border-color: var(--bd);
	}
	.handle {
		color: var(--fg3);
		cursor: grab;
	}
	.emoji {
		font-size: var(--text-lg);
		line-height: 1;
		text-align: center;
	}
	.tail {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
	}
	.types {
		display: inline-flex;
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
		padding: var(--space-1) var(--space-4);
		white-space: nowrap;
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
