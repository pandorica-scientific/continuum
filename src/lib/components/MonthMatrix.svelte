<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Month down, what the month came to across.
	//
	// The register used to be a flat run of cards, one per transaction, ten to a
	// page: it could answer "what was this row" and nothing at all about the
	// month the row belonged to. This is the Tax and Salary matrices' shape
	// applied to the same question, so all three Money screens are read the same
	// way — a collapsed row per period, a summary above them, and the detail
	// underneath the one you open.
	//
	// The two pagers are independent on purpose. This one walks months and is
	// local state, exactly as the Tax and Salary tables' is; the transactions
	// inside an open month are paged by the URL, because they come from the
	// server a month at a time. Paging one must never move the other.
	//
	// Numerics are right-aligned throughout. The whole point is scanning a
	// column, and left-aligned numbers of differing lengths cannot be scanned.
	import type { Snippet } from 'svelte';
	import ListPager from '$lib/components/ListPager.svelte';
	import PageSize, {
		DEFAULT_LIST_PAGE_SIZE,
		LIST_PAGE_SIZES
	} from '$lib/components/PageSize.svelte';

	interface MonthCurrency {
		currency: string;
		in: string;
		out: string;
		net: string;
		negative: boolean;
		/** Share of the widest month in this currency, 0–100, in and out. */
		inPct: number;
		outPct: number;
	}
	export interface MonthRow {
		month: string;
		label: string;
		count: number;
		currencies: MonthCurrency[];
		/** Opens this month, or closes it when it is the open one. */
		href: string;
	}

	let {
		months,
		openMonth,
		totals,
		total,
		detail
	}: {
		months: MonthRow[];
		openMonth: string | null;
		/** What every month listed comes to, per currency. */
		totals: { currency: string; in: string; out: string; net: string; negative: boolean }[];
		total: number;
		detail?: Snippet<[string]>;
	} = $props();

	let size = $state<number>(DEFAULT_LIST_PAGE_SIZE);
	const pages = $derived(Math.max(1, Math.ceil(months.length / size)));
	let page = $state(0);
	// A record that shrank — a narrower filter, a deleted row — must not strand
	// the view on a page that no longer exists.
	$effect(() => {
		if (page > pages - 1) page = 0;
	});

	// An open month has to be reachable. Arriving on a link, or filtering until
	// the month you were reading moved, would otherwise leave the register with
	// an expanded row on a page nobody is looking at. Guarded on the month
	// CHANGING, so paging away from an open month is still allowed.
	let followed: string | null = null;
	$effect(() => {
		if (openMonth === followed) return;
		followed = openMonth;
		if (!openMonth) return;
		const index = months.findIndex((m) => m.month === openMonth);
		if (index >= 0) page = Math.floor(index / size);
	});

	const rows = $derived(months.slice(page * size, page * size + size));
	const pageRange = $derived(
		rows.length === 0
			? ''
			: rows.length === 1
				? rows[0].month
				: `${rows.at(-1)!.month} – ${rows[0].month}`
	);

	// 190px month, one fraction each for in and out, 210px for the net. The two
	// flexible columns carry a minimum rather than a floor of zero, so a heading
	// can never be squeezed narrower than the word it prints.
	const MONTH = 190;
	const FLEX_MIN = 120;
	const NET = 210;
	const COLUMNS = `${MONTH}px minmax(${FLEX_MIN}px, 1fr) minmax(${FLEX_MIN}px, 1fr) ${NET}px`;
	// Every column at its minimum, plus the three gaps and the row's own padding.
	const MIN_WIDTH = `calc(${MONTH + 2 * FLEX_MIN + NET}px + 3 * var(--space-5) + 2 * var(--space-6))`;
</script>

<div class="matrix" style:--row-cols={COLUMNS} style:--row-min={MIN_WIDTH}>
	{#if months.length > LIST_PAGE_SIZES[0]}
		<!-- Above the rows it sizes: how much to show is a decision made before
		     reading, while which page to read is one made after. -->
		<div class="tools">
			<PageSize bind:size onchange={() => (page = 0)} label="months" />
		</div>
	{/if}

	<div class="scroll">
		<div class="head">
			<span class="h-cell">Month</span>
			<span class="h-cell right"><span class="swatch in"></span>In</span>
			<span class="h-cell right"><span class="swatch out"></span>Out</span>
			<span class="h-cell right">Net</span>
		</div>

		{#if months.length > 0}
			<div class="summary">
				<span class="f-cell">
					<span class="f-label">All</span>
					<span class="c-sub">
						{months.length}
						{months.length === 1 ? 'month' : 'months'} · {total}
						{total === 1 ? 'transaction' : 'transactions'}
					</span>
				</span>
				<span class="f-cell right">
					<span class="c-label">in</span>
					{#each totals as t (t.currency)}
						<span class="mono in">{t.in}</span>
					{/each}
				</span>
				<span class="f-cell right">
					<span class="c-label">out</span>
					{#each totals as t (t.currency)}
						<span class="mono out">{t.out}</span>
					{/each}
				</span>
				<span class="f-cell right">
					<span class="c-label">net</span>
					{#each totals as t (t.currency)}
						<span class="net-line">
							<span class="c-sub">{t.currency}</span>
							<span class="mono t-value" class:short={t.negative}>{t.net}</span>
						</span>
					{/each}
				</span>
			</div>
		{/if}

		{#each rows as row (row.month)}
			{@const open = openMonth === row.month}
			<!-- A link, not a button that posts: which month is open lives in the
			     URL like every other part of this view, so a narrowed register stays
			     shareable at the month it was read in. noscroll, because expanding a
			     row in place should not throw the page back to its top. -->
			<a
				class="row"
				class:open
				href={row.href}
				data-sveltekit-noscroll
				data-sveltekit-keepfocus
				aria-expanded={open}
			>
				<span class="month">
					<span class="chevron" class:open>{open ? '▼' : '▶'}</span>
					<span class="m-name">
						<span class="m-label">{row.label}</span>
						<span class="c-sub">
							{row.count}
							{row.count === 1 ? 'transaction' : 'transactions'}
						</span>
					</span>
				</span>

				<span class="cell right">
					<span class="c-label">in</span>
					{#each row.currencies as c (c.currency)}
						<span class="mono c-value in">{c.in}</span>
					{/each}
				</span>

				<span class="cell right">
					<span class="c-label">out</span>
					{#each row.currencies as c (c.currency)}
						<span class="mono c-value out">{c.out}</span>
					{/each}
				</span>

				<span class="cell right net">
					<span class="c-label">net</span>
					{#each row.currencies as c (c.currency)}
						<span class="net-line">
							<span class="c-sub">{c.currency}</span>
							<span class="mono t-value" class:short={c.negative}>{c.net}</span>
						</span>
						<!-- In beside out, both scaled against the widest month IN THE SAME
						     currency — the one scale on which two months can honestly be
						     compared. A month in another currency gets its own. -->
						<span class="track" aria-hidden="true">
							<span class="fill in" style:width="{c.inPct}%"></span>
							<span class="fill out" style:width="{c.outPct}%"></span>
						</span>
					{/each}
				</span>
			</a>

			{#if open && detail}
				{@render detail(row.month)}
			{/if}
		{/each}
	</div>

	<!-- Shown whenever the record is longer than the smallest page size, even
	     when the current size fits it all: the size switcher lives here, and
	     hiding it would leave no way back to a smaller page. -->
	{#if months.length > LIST_PAGE_SIZES[0]}
		<ListPager bind:page {pages} range={pageRange} />
	{/if}
</div>

<style>
	.matrix {
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		overflow: hidden;
		background: var(--surface);
	}
	/* Below its minimum the columns stop fitting. The grid scrolls rather than
	   reflowing into cards — cards are what this replaced. */
	.scroll {
		overflow-x: auto;
		min-width: 0;
	}
	.tools {
		display: flex;
		justify-content: flex-end;
		padding: 8px var(--space-6);
		border-bottom: 1px solid var(--bd2);
	}
	.head,
	.row,
	.summary {
		display: grid;
		grid-template-columns: var(--row-cols);
		align-items: center;
		gap: var(--space-5);
		padding: 10px var(--space-6);
		min-width: var(--row-min);
	}
	.head {
		background: var(--card2);
		border-bottom: 1px solid var(--bd2);
	}
	.h-cell {
		font-size: var(--text-xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg3);
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.right {
		justify-content: flex-end;
		text-align: right;
	}
	.swatch {
		width: 9px;
		height: 9px;
		border-radius: var(--radius-xs);
		flex: none;
	}
	.swatch.in {
		background: var(--green);
	}
	.swatch.out {
		background: var(--red);
	}
	/* Above the months, so its rule is beneath it rather than over it. */
	.summary {
		background: var(--card2);
		border-bottom: 1px solid var(--bd2);
	}
	.f-cell {
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-size: var(--text-md);
		color: var(--fg2);
		min-width: 0;
	}
	.f-cell.right {
		align-items: flex-end;
	}
	.f-label {
		font-size: var(--text-lg, var(--text-md));
		color: var(--fg1);
	}
	.row {
		border-bottom: 1px solid var(--bd2);
		cursor: pointer;
		color: inherit;
		text-decoration: none;
		/* Reserved on every row so opening one does not shift its figures
		   sideways by the width of the accent. */
		box-shadow: inset 3px 0 0 transparent;
	}
	.row:hover {
		background: var(--card2);
		text-decoration: none;
	}
	.row.open {
		background: var(--card2);
		box-shadow: inset 3px 0 0 var(--blue);
	}
	.month {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
	}
	.m-name {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.m-label {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.chevron {
		font-size: 9px;
		color: var(--fg3);
		flex: none;
	}
	.chevron.open {
		color: var(--blue);
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.c-value {
		font-size: var(--text-md);
	}
	.c-sub {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.in {
		color: var(--green);
	}
	.out {
		color: var(--red);
	}
	.net-line {
		display: flex;
		align-items: baseline;
		justify-content: flex-end;
		gap: var(--space-3);
		min-width: 0;
	}
	.t-value {
		font-size: var(--text-lg, var(--text-md));
		font-weight: 600;
		color: var(--fg1);
		letter-spacing: 0.01em;
	}
	/* Red only when the month ran short. Every other month is the ordinary case,
	   and colouring all of them would leave nothing for the exception. */
	.t-value.short {
		color: var(--red);
	}
	.track {
		display: flex;
		width: 100%;
		height: 3px;
		border-radius: 2px;
		background: var(--bd2);
		margin-top: 4px;
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
	}
	.fill.in {
		background: var(--green);
	}
	.fill.out {
		background: var(--red);
	}
	.c-label {
		display: none;
		font-size: var(--text-xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg3);
	}
	/*
	 * A phone gets rows instead of columns.
	 *
	 * Four columns of figures cannot be made to fit 390px, and scrolling the
	 * register sideways to read what a month came to is worse than reading it
	 * down. So the heading row goes, the month takes a line of its own, and the
	 * three figures share the line beneath it — each naming itself, since the
	 * heading that named it is no longer there.
	 */
	@media (max-width: 720px) {
		.head {
			display: none;
		}
		.row,
		.summary {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			row-gap: var(--space-3);
			min-width: 0;
		}
		.month,
		.summary .f-cell:first-child {
			grid-column: 1 / -1;
		}
		.cell.right,
		.f-cell.right {
			align-items: flex-start;
			text-align: left;
		}
		.net-line {
			justify-content: flex-start;
		}
		.c-label {
			display: block;
		}
		/* Against a figure that now starts at the cell's left edge, a bar running
		   the cell's full width no longer reads as belonging to it. */
		.track {
			display: none;
		}
	}
</style>
