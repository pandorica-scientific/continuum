<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The shelf list down the left of the Cookbook.
	 *
	 * The same treatment as the Documents rail, including the contained
	 * overscroll — a long list of categories over a scrolling page hands the
	 * wheel on at its end otherwise, and scrolling back moves the wrong thing.
	 */
	import Icon from '$lib/components/Icon.svelte';

	interface Category {
		id: string;
		name: string;
		emoji: string;
		count: number;
	}

	let {
		categories,
		selected,
		total,
		onselect,
		onadd
	}: {
		categories: Category[];
		/** null is "everything", which is where the screen opens. */
		selected: string | null;
		total: number;
		onselect: (id: string | null) => void;
		onadd: () => void;
	} = $props();
</script>

<nav class="rail" aria-label="Recipe categories">
	<button
		class="row"
		class:active={selected === null}
		type="button"
		onclick={() => onselect(null)}
		aria-current={selected === null ? 'true' : undefined}
	>
		<span class="mark" aria-hidden="true">📖</span>
		<span class="name">Everything</span>
		<span class="count mono">{total}</span>
	</button>

	{#if categories.length === 0}
		<!-- A cold start: the rail is otherwise one row saying nought, which reads
		     as a screen that failed rather than one waiting to be filled. -->
		<p class="nothing">No shelves yet. Every recipe goes on one.</p>
	{/if}

	{#each categories as category (category.id)}
		<button
			class="row"
			class:active={selected === category.id}
			type="button"
			onclick={() => onselect(category.id)}
			aria-current={selected === category.id ? 'true' : undefined}
		>
			<span class="mark" aria-hidden="true">{category.emoji || '🍽️'}</span>
			<span class="name">{category.name}</span>
			<span class="count mono">{category.count}</span>
		</button>
	{/each}

	<button class="add" type="button" onclick={onadd}>
		<Icon name="plus" size={14} /> New category
	</button>
</nav>

<style>
	.rail {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--card);
		max-height: 70vh;
		overflow-y: auto;
		/* See docs/ui-guidelines.md: anything scrollable over scrollable content
		   contains its own overscroll. */
		overscroll-behavior: contain;
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		width: 100%;
		min-height: auto;
		padding: var(--space-4) var(--space-5);
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--fg2);
		text-align: left;
		transition:
			background-color var(--dur) var(--ease),
			color var(--dur) var(--ease);
	}
	.row:hover {
		background: var(--surface-2);
		color: var(--fg1);
	}
	.row.active {
		background: var(--rose-tint);
		color: var(--fg1);
	}
	.mark {
		flex: none;
		font-size: var(--text-lg);
	}
	.name {
		flex: 1;
		min-width: 0;
		font-size: var(--text-md);
	}
	.count {
		flex: none;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.nothing {
		margin: var(--space-3) var(--space-5) 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.add {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: auto;
		margin-top: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border: 1px dashed var(--bd2);
		border-radius: var(--radius-ctl);
		background: none;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.add:hover {
		border-color: color-mix(in srgb, var(--rose) 55%, transparent);
		color: var(--rose);
	}

	/* A row of chips on a phone: a rail beside a grid at 400px is two columns of
	   nothing. */
	@media (max-width: 899px) {
		.rail {
			flex-direction: row;
			flex-wrap: wrap;
			max-height: none;
			overflow: visible;
		}
		.row {
			width: auto;
		}
		.name {
			flex: none;
		}
		.add {
			margin-top: 0;
		}
	}
</style>
