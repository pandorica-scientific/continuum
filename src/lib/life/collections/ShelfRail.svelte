<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The shelves down the left of Collections.
	 *
	 * Built for three shelves and shipped with one. The Cellar is the only kind
	 * v0.9.0 knows how to draw, but the rail is a list from the start — not a
	 * heading pretending to be one — so books and records land in it without the
	 * screen being rebuilt around them.
	 */
	import Icon from '$lib/components/Icon.svelte';

	interface Shelf {
		id: string;
		name: string;
		emoji: string;
		count: number;
	}

	let {
		shelves,
		selected,
		onselect
	}: {
		shelves: Shelf[];
		selected: string | null;
		onselect: (id: string) => void;
	} = $props();
</script>

<nav class="rail" aria-label="Shelves">
	{#each shelves as shelf (shelf.id)}
		<button
			class="row"
			class:active={selected === shelf.id}
			type="button"
			onclick={() => onselect(shelf.id)}
			aria-current={selected === shelf.id ? 'true' : undefined}
		>
			<span class="mark" aria-hidden="true">{shelf.emoji || '🗄️'}</span>
			<span class="name">{shelf.name}</span>
			<span class="count mono">{shelf.count}</span>
		</button>
	{/each}

	<!-- Disabled rather than absent: the shape of what is coming is part of
	     understanding what this screen is, and a rail with one row and no hint
	     reads as a rail that is broken. -->
	<button class="add" type="button" disabled>
		<Icon name="plus" size={14} /> New shelf
	</button>
	<p class="soon">More shelf types are coming. Books and records are the next two.</p>
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
		opacity: 0.55;
	}
	.soon {
		margin: var(--space-3) var(--space-5) 0;
		font-size: var(--text-sm);
		line-height: 1.45;
		color: var(--fg3);
	}

	/* A row of chips on a phone: a rail beside a grid at 400px is two columns of
	   nothing. */
	@media (max-width: 899px) {
		.rail {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
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
		.soon {
			flex-basis: 100%;
			margin: 0 var(--space-5);
		}
	}
</style>
