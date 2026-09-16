<script lang="ts" generics="Row">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';
	import { gridTemplate, visibleColumns, type Column, type Group } from './data-table';

	/**
	 * The one table. A screen brings its columns, groups and cells; this draws
	 * the shared chrome: header strip, row line, open group's ground, summary
	 * row, hover.
	 *
	 * Groups, not rows, are the unit — a table of things you open (a month, a
	 * category, a year, a type). A group head is a button; rows under it may
	 * hold their own forms and buttons, so the head can't — nested interactive
	 * content is invalid HTML. A head needing a control beside it uses `aside`.
	 *
	 * Columns hide by breakpoint (`hideBelow`); snippets receive the set of
	 * visible keys so a hidden cell isn't rendered at all, rather than
	 * `display:none`d while still claiming a grid track.
	 */
	interface Props {
		columns: Column[];
		groups: Group<Row>[];
		/** The token whose ink marks an open group's edge. */
		hue?: string;
		/** aria-label for the table. */
		label: string;
		rowKey: (row: Row) => string;
		/** Opens or closes a group. Ignored when `href` is given: the URL is the state then. */
		ontoggle?: (key: string) => void;
		/**
		 * A group head as a link rather than a button, for a table whose open
		 * group lives in the URL. The link is expected to toggle: the same href
		 * closes the group it opened.
		 */
		href?: (group: Group<Row>) => string;
		/**
		 * `grid` lays every row on the table's columns. `block` hands the row
		 * snippet the full width, for a row that is a component with a grid of
		 * its own (a transaction, which opens into a panel).
		 */
		rowLayout?: 'grid' | 'block';
		/**
		 * No groups at all: every row of every group is drawn on the grid with
		 * no head above it, for a list that is one flat run (holdings). The
		 * `head` snippet is not rendered.
		 */
		flat?: boolean;
		/** Extra class names for one row — `now` on the row that is today. */
		rowClass?: (row: Row) => string | undefined;
		head?: Snippet<[Group<Row>, ReadonlySet<string>]>;
		row: Snippet<[Row, ReadonlySet<string>, Group<Row>]>;
		/** Drawn under an open group's head, right-aligned: a page-size control, a caption. */
		aside?: Snippet<[Group<Row>]>;
		/** The row above the groups that totals them. */
		summary?: Snippet<[ReadonlySet<string>]>;
		/** Drawn under the last group: a pager, a note. */
		foot?: Snippet;
		/** Drawn instead of the groups when there are none. */
		empty?: Snippet;
	}

	let {
		columns,
		groups,
		hue = '--fg3',
		label,
		rowKey,
		ontoggle,
		href,
		rowLayout = 'grid',
		flat = false,
		rowClass,
		head,
		row,
		aside,
		summary,
		foot,
		empty
	}: Props = $props();

	let box = $state<HTMLElement | null>(null);
	// null until measured: server and first frame draw the wide layout.
	let width = $state<number | null>(null);

	$effect(() => {
		const element = box;
		if (!element) return;
		// Measure synchronously first — ResizeObserver never fires in a hidden document.
		width = element.getBoundingClientRect().width;
		const observer = new ResizeObserver(([entry]) => {
			width = entry.contentRect.width;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	const visible = $derived(visibleColumns(columns, width));
	const visibleKeys = $derived<ReadonlySet<string>>(new Set(visible.map((c) => c.key)));
	const template = $derived(gridTemplate(visible));
	const token = $derived(hue.startsWith('--') ? hue : `--${hue}`);
</script>

<section
	class="dt"
	aria-label={label}
	bind:this={box}
	style:--dt-cols={template}
	style:--dt-hue="var({token})"
>
	<div class="dt-head">
		{#each visible as c (c.key)}
			<span class="dt-th" class:end={c.align === 'end'} class:center={c.align === 'center'}
				>{c.label}</span
			>
		{/each}
	</div>

	{#if summary}
		<div class="dt-summary">{@render summary(visibleKeys)}</div>
	{/if}

	{#if groups.length === 0 && empty}
		<div class="dt-empty">{@render empty()}</div>
	{/if}

	{#each groups as group (group.key)}
		{#if flat}
			{#each group.rows as r (rowKey(r))}
				<div class="dt-row {rowClass?.(r) ?? ''}" class:block={rowLayout === 'block'}>
					{@render row(r, visibleKeys, group)}
				</div>
			{/each}
		{:else if href}
			<a
				class="dt-group"
				class:open={group.open}
				href={href(group)}
				data-sveltekit-noscroll
				data-sveltekit-keepfocus
				aria-expanded={group.open}
			>
				{@render head?.(group, visibleKeys)}
			</a>
		{:else}
			<button
				type="button"
				class="dt-group"
				class:open={group.open}
				aria-expanded={group.open}
				onclick={() => ontoggle?.(group.key)}
			>
				{@render head?.(group, visibleKeys)}
			</button>
		{/if}
		{#if group.open && !flat}
			{#if aside}
				<div class="dt-aside">{@render aside(group)}</div>
			{/if}
			{#each group.rows as r (rowKey(r))}
				<div class="dt-row {rowClass?.(r) ?? ''}" class:block={rowLayout === 'block'}>
					{@render row(r, visibleKeys, group)}
				</div>
			{/each}
		{/if}
	{/each}

	{#if foot}
		<div class="dt-foot">{@render foot()}</div>
	{/if}
</section>

<style>
	.dt {
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		overflow: hidden;
		min-width: 0;
	}

	/* Head, group heads and rows share one grid so columns line up through
	   open and closed groups alike. */
	.dt-head,
	.dt-group,
	.dt-row,
	.dt-summary {
		display: grid;
		grid-template-columns: var(--dt-cols);
		align-items: center;
		gap: var(--space-6);
		padding: var(--space-5) var(--space-7);
		min-width: 0;
	}

	.dt-head {
		background: var(--table-head);
		color: var(--fg3);
		font-size: var(--text-xs);
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.dt-th {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dt-th.end {
		text-align: end;
	}
	.dt-th.center {
		text-align: center;
	}

	.dt-summary {
		background: var(--surface-2);
		font-weight: 600;
		border-top: 1px solid var(--bd);
	}

	/* A group head is a button or a link, styled as neither. */
	.dt-group {
		appearance: none;
		border: 0;
		border-top: 1px solid var(--bd);
		background: transparent;
		color: var(--fg1);
		font: inherit;
		text-align: start;
		text-decoration: none;
		width: 100%;
		min-height: 44px;
		cursor: pointer;
		transition: background-color var(--dur) var(--ease);
	}
	.dt-group:hover {
		background: var(--surface-2);
		text-decoration: none;
	}
	.dt-group:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: -2px;
	}
	/* Open group's ground: a step up from the table, hue's edge down the left.
	   Rows stay on the table's own surface so it reads as a lid lifted. */
	.dt-group.open {
		background: var(--table-open);
		box-shadow: inset 3px 0 0 var(--dt-hue);
	}
	.dt-aside {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: var(--space-4);
		padding: 0 var(--space-7) var(--space-4);
		background: var(--table-open);
		box-shadow: inset 3px 0 0 var(--dt-hue);
	}

	.dt-row {
		border-top: 1px solid var(--bd);
		transition: background-color var(--dur) var(--ease);
	}
	.dt-row:hover {
		background: var(--surface-2);
	}
	/* The row that is now: a step up and heavier. */
	.dt-row.now {
		background: var(--surface-2);
		font-weight: 600;
	}
	/* A block row draws its own face and hover — no grid, no padding, no hover here. */
	.dt-row.block {
		display: block;
		padding: 0;
	}
	.dt-row.block:hover {
		background: transparent;
	}

	.dt-empty {
		padding: var(--space-8) var(--space-7);
		color: var(--fg3);
		font-size: var(--text-md);
		border-top: 1px solid var(--bd);
	}
	.dt-foot {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-7);
		border-top: 1px solid var(--bd);
		color: var(--fg3);
		font-size: var(--text-sm);
	}

	@media (max-width: 719px) {
		.dt-head,
		.dt-group,
		.dt-row,
		.dt-summary {
			padding: var(--space-4) var(--space-5);
			gap: var(--space-4);
		}
	}
</style>
