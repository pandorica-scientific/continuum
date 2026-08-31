<script module lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The grid every row in this table is built on.
	 *
	 * Year, then the three that make up gross, then what it averaged and what
	 * survived tax. The header, the summary, every year row and the payslips an
	 * expanded year renders underneath all read it off the `--row-cols` and
	 * `--row-min` custom properties set on the table, so none can drift out of
	 * line — the payslip rows included, and those live on the Salary screen
	 * rather than here, so they used to import the column string to keep step.
	 *
	 * Base and Bonus are the two flexible columns, and they carry a MINIMUM
	 * rather than `minmax(0, 1fr)`. With a floor of zero the scroll width below
	 * was all that held them open, and at that width it left them about 35px
	 * each — narrower than the word "Bonus" — so on a phone the two headings
	 * printed over one another.
	 */
	const YEAR = 96;
	const FLEX_MIN = 112;
	const GROSS = 190;
	const AVG = 140;
	const NET = 150;

	const COLUMNS = `${YEAR}px minmax(${FLEX_MIN}px, 1fr) minmax(${FLEX_MIN}px, 1fr) ${GROSS}px ${AVG}px ${NET}px`;

	/**
	 * The narrowest the grid may be drawn before it scrolls: every column at its
	 * minimum, plus the five gaps between them and the row's own padding.
	 *
	 * Derived from the same numbers as the columns rather than written out beside
	 * them — a hand-kept figure is exactly what let the two disagree. The 720px
	 * floor is the width the table had before any column carried a minimum.
	 */
	const MIN_WIDTH = `max(720px, calc(${YEAR + 2 * FLEX_MIN + GROSS + AVG + NET}px + 5 * var(--space-5) + 2 * var(--space-6)))`;
</script>

<script lang="ts">
	// Year down, what a year was made of across.
	//
	// The Salary screen used to be one repeated block per person — a chart, then
	// a flat list of payslips — with nothing that answered "what did 2025 come
	// to". This is the Tax matrix's shape applied to the same question, so the
	// two Money screens are read the same way.
	//
	// Base and bonus are the breakdown and gross is their sum, exactly as a tax
	// year's jurisdictions add up to its year total. Net and the monthly average
	// are context beside them, never summed into the total: net is what arrived
	// after tax and adding it to gross would be counting the same pay twice.
	//
	// Numerics are right-aligned throughout. The whole point is scanning a
	// column, and left-aligned numbers of differing lengths cannot be scanned.
	import { compactMinor, displayCurrency, formatMinor } from '$lib/money';
	import type { Snippet } from 'svelte';
	import ListPager from '$lib/components/ListPager.svelte';
	import PageSize, {
		DEFAULT_LIST_PAGE_SIZE,
		LIST_PAGE_SIZES
	} from '$lib/components/PageSize.svelte';

	interface SerialisedSalaryYear {
		year: number;
		age: number | null;
		grossAvgMinor: string | null;
		netAvgMinor: string | null;
		grossTotalMinor: string;
		baseTotalMinor: string;
		bonusTotalMinor: string;
		netTotalMinor: string;
		grossMonths: number;
		netMonths: number;
		netComplete: boolean;
		deltaPct: number | null;
		baseDeltaPct: number | null;
	}

	let {
		years,
		currency,
		openYear,
		onToggle,
		detail
	}: {
		years: SerialisedSalaryYear[];
		currency: string;
		openYear: number | null;
		onToggle: (year: number) => void;
		detail?: Snippet<[number]>;
	} = $props();

	const symbol = $derived(displayCurrency(currency));

	/** Newest first: the year a person opens this screen for is the last one. */
	const ordered = $derived([...years].sort((a, b) => b.year - a.year));

	let size = $state<number>(DEFAULT_LIST_PAGE_SIZE);
	const pages = $derived(Math.max(1, Math.ceil(ordered.length / size)));
	let page = $state(0);
	$effect(() => {
		if (page > pages - 1) page = 0;
	});
	const rows = $derived(ordered.slice(page * size, page * size + size));
	const pageRange = $derived(
		rows.length === 0
			? ''
			: rows.length === 1
				? `${rows[0].year}`
				: `${rows.at(-1)!.year}–${rows[0].year}`
	);

	// Over every year, never the visible page: a bar whose scale changed as you
	// paged would mean something different on page two than on page one.
	const ceiling = $derived(
		years.reduce(
			(most, y) => (BigInt(y.grossTotalMinor) > most ? BigInt(y.grossTotalMinor) : most),
			0n
		)
	);

	const sum = (pick: (y: SerialisedSalaryYear) => string) =>
		years.reduce((total, y) => total + BigInt(pick(y)), 0n);

	const lifetime = $derived({
		base: sum((y) => y.baseTotalMinor),
		bonus: sum((y) => y.bonusTotalMinor),
		net: sum((y) => y.netTotalMinor),
		gross: sum((y) => y.grossTotalMinor),
		grossMonths: years.reduce((n, y) => n + y.grossMonths, 0),
		netMonths: years.reduce((n, y) => n + y.netMonths, 0),
		bonusYears: years.filter((y) => BigInt(y.bonusTotalMinor) > 0n).length
	});

	/** Lifetime monthly average, over the months that actually carry a gross. */
	const lifetimeAvg = $derived(
		lifetime.grossMonths === 0 ? null : lifetime.gross / BigInt(lifetime.grossMonths)
	);
</script>

<div class="matrix" style:--row-cols={COLUMNS} style:--row-min={MIN_WIDTH}>
	{#if ordered.length > LIST_PAGE_SIZES[0]}
		<!-- Above the rows it sizes: how much to show is a decision made before
		     reading, while which page to read is one made after. -->
		<div class="tools">
			<PageSize bind:size onchange={() => (page = 0)} label="years" />
		</div>
	{/if}

	<div class="scroll">
		<!-- One label, over the column that needs it. Base, bonus and gross
		     already say what they are and that they add up; net is the one figure
		     whose relation to the others is not visible from its name, so it gets
		     the heading and the rule beside it. -->
		<div class="group">
			<span class="g-cell span5"></span>
			<span class="g-cell divide">After tax</span>
		</div>

		<div class="head">
			<span class="h-cell">Year</span>
			<span class="h-cell right"><span class="swatch base"></span>Base</span>
			<span class="h-cell right"><span class="swatch bonus"></span>Bonus</span>
			<span class="h-cell right">Gross · {symbol}</span>
			<span class="h-cell right">Avg month</span>
			<span class="h-cell right divide">Net</span>
		</div>

		{#if ordered.length > 0}
			<div class="summary">
				<span class="f-cell">
					<span class="f-label">All</span>
					<span class="c-sub">{years.length} {years.length === 1 ? 'year' : 'years'}</span>
				</span>
				<span class="f-cell right">
					<span class="mono">{compactMinor(lifetime.base, currency)}</span>
					<span class="c-sub">
						over {lifetime.grossMonths}
						{lifetime.grossMonths === 1 ? 'month' : 'months'}
					</span>
				</span>
				<span class="f-cell right">
					<span class="mono">{compactMinor(lifetime.bonus, currency)}</span>
					<span class="c-sub">
						in {lifetime.bonusYears} of {years.length}
						{years.length === 1 ? 'year' : 'years'}
					</span>
				</span>
				<span class="f-cell right">
					<span class="mono t-value">{formatMinor(lifetime.gross, currency)}</span>
					<span class="c-sub">every month recorded</span>
				</span>
				<span class="f-cell right">
					<span class="mono">
						{lifetimeAvg === null ? '·' : compactMinor(lifetimeAvg, currency)}
					</span>
					<span class="c-sub">
						over {lifetime.grossMonths}
						{lifetime.grossMonths === 1 ? 'month' : 'months'}
					</span>
				</span>
				<span class="f-cell right divide">
					<span class="mono">{compactMinor(lifetime.net, currency)}</span>
					<span class="c-sub">
						over {lifetime.netMonths}
						{lifetime.netMonths === 1 ? 'month' : 'months'}
					</span>
				</span>
			</div>
		{/if}

		{#each rows as row (row.year)}
			{@const open = openYear === row.year}
			{@const gross = BigInt(row.grossTotalMinor)}
			{@const bonus = BigInt(row.bonusTotalMinor)}
			<div
				class="row"
				class:open
				role="button"
				tabindex="0"
				aria-expanded={open}
				onclick={() => onToggle(row.year)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onToggle(row.year);
					}
				}}
			>
				<span class="year mono">
					<span class="chevron" class:open>{open ? '▼' : '▶'}</span>
					{row.year}
				</span>

				<span class="cell right">
					<span class="mono c-value">{compactMinor(BigInt(row.baseTotalMinor), currency)}</span>
					{#if row.baseDeltaPct !== null}
						<!-- Base against base: a one-off bonus moves the total up one year
						     and down the next, which reads as a raise then a pay cut. -->
						<span class="c-sub" class:up={row.baseDeltaPct > 0} class:down={row.baseDeltaPct < 0}>
							{row.baseDeltaPct > 0 ? '+' : ''}{row.baseDeltaPct}%
						</span>
					{:else}
						<span class="c-sub quiet">—</span>
					{/if}
				</span>

				<span class="cell right">
					{#if bonus > 0n}
						<span class="mono c-value">{compactMinor(bonus, currency)}</span>
						<span class="c-sub">{Math.round((Number(bonus) / Number(gross)) * 100)}% of gross</span>
					{:else}
						<!-- Not a zero: the slips for this year did not itemise a bonus,
						     which is a different statement from stating there was none. -->
						<span class="absent">·</span>
						<span class="c-sub quiet">not itemised</span>
					{/if}
				</span>

				<!-- Gross carries the weight: it is what base and bonus add up to, and
				     the one column where every row shares a currency — so the only one
				     where comparing bar lengths is honest. -->
				<span class="cell right gross">
					<span class="mono t-value">{formatMinor(gross, currency)}</span>
					<span class="track">
						<span
							class="fill"
							style:width="{ceiling === 0n
								? 0
								: Math.max(2, (Number(gross) / Number(ceiling)) * 100)}%"
						></span>
					</span>
				</span>

				<span class="cell right">
					{#if row.grossAvgMinor !== null}
						<span class="mono c-value">
							{compactMinor(BigInt(row.grossAvgMinor), currency)}
						</span>
						{#if row.deltaPct !== null}
							<span class="c-sub" class:up={row.deltaPct > 0} class:down={row.deltaPct < 0}>
								{row.deltaPct > 0 ? '+' : ''}{row.deltaPct}%
							</span>
						{:else}
							<span class="c-sub quiet">first year</span>
						{/if}
					{:else}
						<span class="absent">·</span>
					{/if}
				</span>

				<span class="cell right divide">
					{#if row.netMonths > 0}
						<span class="mono c-value">{compactMinor(BigInt(row.netTotalMinor), currency)}</span>
						<!-- "3 of 12 months" rather than a warning triangle: an annual total
						     over three months is a partial year, not a collapse, and saying
						     which is more use than flagging that something is off. -->
						<span class="c-sub" class:partial={!row.netComplete}>
							{row.netComplete ? `over ${row.netMonths} months` : `${row.netMonths} of 12 months`}
						</span>
					{:else}
						<span class="absent">·</span>
						<span class="c-sub quiet">no credits filed</span>
					{/if}
				</span>
			</div>

			{#if open && detail}
				{@render detail(row.year)}
			{/if}
		{/each}
	</div>

	<!-- Shown whenever the record is longer than the smallest page size, even
	     when the current size fits it all: the size switcher lives here, and
	     hiding it would leave no way back to a smaller page. -->
	{#if ordered.length > LIST_PAGE_SIZES[0]}
		<ListPager bind:page {pages} range={pageRange} />
	{/if}
</div>

<style>
	.matrix {
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		overflow: hidden;
		background: var(--card);
	}
	/* Below roughly 900px the columns stop fitting. The grid scrolls rather than
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
	.group,
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
	/* The tier that says which side of tax a column is on. */
	.group {
		background: var(--card2);
		padding-bottom: 0;
	}
	.g-cell {
		font-size: var(--text-xs);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--fg3);
		opacity: 0.7;
	}
	.g-cell.span5 {
		grid-column: span 5;
	}
	.head {
		background: var(--card2);
		border-bottom: 1px solid var(--bd2);
		padding-top: 4px;
	}
	/* One rule down the table, separating what was earned from what survived
	   tax. Six equal columns made those read as six comparable quantities.
	   Centred in the gutter rather than pulled to its far edge, which put the
	   line hard against the previous column's last character. */
	.divide {
		border-left: 1px solid var(--bd2);
		padding-left: calc(var(--space-5) / 2);
		margin-left: calc(var(--space-5) / -2);
	}
	/* Right-aligned, so the heading sits over the figures it names rather than
	   against the rule beside a column of right-aligned numbers. */
	.g-cell.divide {
		text-align: right;
	}
	.h-cell {
		font-size: var(--text-xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg3);
		display: flex;
		align-items: center;
		gap: var(--space-3);
		/* A flex item's automatic minimum is its content, so without this a
		   heading wider than its column spills into the one beside it rather
		   than being held inside its own track. */
		min-width: 0;
	}
	.h-cell.right {
		justify-content: flex-end;
	}
	.swatch {
		width: 9px;
		height: 9px;
		border-radius: 2px;
		flex: none;
	}
	.swatch.base {
		background: var(--series-health-soft);
	}
	.swatch.bonus {
		background: var(--orange);
	}
	/* Above the years, so its rule is beneath it rather than over it. */
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
	.f-label {
		font-size: var(--text-lg, var(--text-md));
		color: var(--fg1);
	}
	.f-cell.right {
		align-items: flex-end;
	}
	.row {
		border-bottom: 1px solid var(--bd2);
		cursor: pointer;
		/* Reserved on every row so opening one does not shift its figures
		   sideways by the width of the accent. */
		box-shadow: inset 3px 0 0 transparent;
	}
	.row:hover {
		background: var(--card2);
	}
	.row.open {
		background: var(--card2);
		box-shadow: inset 3px 0 0 var(--green);
	}
	.year {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.chevron {
		font-size: 9px;
		color: var(--fg3);
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.cell.right {
		align-items: flex-end;
	}
	.c-value {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.c-sub {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.c-sub.up {
		color: var(--green);
	}
	.c-sub.down {
		color: var(--red);
	}
	/* Amber, not red: a part-year total is incomplete, not wrong. */
	.c-sub.partial {
		color: var(--yellow);
	}
	.c-sub.quiet {
		opacity: 0.55;
	}
	.absent {
		color: var(--fg3);
	}
	.t-value {
		font-size: var(--text-lg, var(--text-md));
		font-weight: 600;
		color: var(--fg1);
		letter-spacing: 0.01em;
	}
	.cell.gross {
		gap: 5px;
	}
	.track {
		width: 100%;
		height: 3px;
		border-radius: 2px;
		background: var(--bd2);
		margin-top: 3px;
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--series-health-soft);
	}
	.absent {
		color: var(--fg3);
	}
</style>
