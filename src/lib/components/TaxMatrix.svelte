<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Year down, jurisdiction across.
	//
	// This replaces a list grouped by person·country, which is the axis the rows
	// were entered on rather than the axis they are read on: under that grouping
	// one year appeared in three separate places, so "what did 2024 cost me" was
	// a question the layout could not answer.
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
	import DataTable from '$lib/components/DataTable.svelte';
	import type { Column, Group } from '$lib/components/data-table';

	interface Country {
		code: string;
		name: string;
		token: string;
	}
	interface SerialisedYear {
		year: number;
		grossMinor: string;
		taxMinor: string;
		ratePct: number | null;
		byCountry: { country: string; grossMinor: string; taxMinor: string; ratePct: number | null }[];
	}

	let {
		years,
		countries,
		currency,
		flaggedThreshold,
		openYear,
		onToggle,
		detail
	}: {
		years: SerialisedYear[];
		countries: Country[];
		currency: string;
		flaggedThreshold: string;
		openYear: number | null;
		onToggle: (year: number) => void;
		detail?: Snippet<[number]>;
	} = $props();

	const threshold = $derived(BigInt(flaggedThreshold));
	const symbol = $derived(displayCurrency(currency));

	/** Newest first: the year a person opens this screen for is the last one. */
	const ordered = $derived([...years].sort((a, b) => b.year - a.year));

	let size = $state<number>(DEFAULT_LIST_PAGE_SIZE);
	const pages = $derived(Math.max(1, Math.ceil(ordered.length / size)));
	let page = $state(0);
	// A record that shrank — a delete, a filter — must not strand the view on a
	// page that no longer exists.
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
		years.reduce((most, y) => (BigInt(y.grossMinor) > most ? BigInt(y.grossMinor) : most), 0n)
	);

	const cellFor = (row: SerialisedYear, code: string) =>
		row.byCountry.find((c) => c.country === code) ?? null;

	/**
	 * A filing far below the median is called out rather than left to pass
	 * unremarked. It is a question, not an accusation — a part-year filing looks
	 * exactly like a units error from here, and only the household knows which.
	 */
	const flagged = (gross: string) => threshold > 0n && BigInt(gross) < threshold;

	/** Lifetime total per jurisdiction, and how many years it filed. Over the
	 *  whole record — a total that counted only the page is not a lifetime one. */
	const perCountry = $derived(
		countries.map((c) => {
			const filings = years.map((y) => cellFor(y, c.code)).filter((x) => x !== null);
			return {
				code: c.code,
				grossMinor: filings.reduce((sum, f) => sum + BigInt(f!.grossMinor), 0n),
				count: filings.length
			};
		})
	);

	const totalGross = $derived(years.reduce((sum, y) => sum + BigInt(y.grossMinor), 0n));
	const totalTax = $derived(years.reduce((sum, y) => sum + BigInt(y.taxMinor), 0n));
	const blended = $derived(
		totalGross === 0n ? null : Number((totalTax * 10000n) / totalGross) / 100
	);

	// 92px year, one fraction per jurisdiction, 196px total. Set as custom
	// properties on the table and read by the header, every row and the summary,
	// so the three cannot drift apart.
	//
	// A jurisdiction column carries a MINIMUM rather than `minmax(0, 1fr)`. With
	// a floor of zero the scroll width was the only thing holding these open, and
	// it divides between however many jurisdictions a household has filed in — so
	// a fourth country squeezed each heading down until they printed over one
	// another.
	const YEAR = 92;
	const COUNTRY_MIN = 104;
	const TOTAL = 196;
	const columns = $derived(
		`${YEAR}px repeat(${countries.length}, minmax(${COUNTRY_MIN}px, 1fr)) ${TOTAL}px`
	);
	// Every column at its minimum, plus one gap between each pair and the row's
	// own padding — derived from the same numbers as the columns above rather
	// than kept by hand beside them. The 620px floor is the width the table had
	// before any column carried a minimum.
	const minWidth = $derived(
		`max(620px, calc(${YEAR + TOTAL + countries.length * COUNTRY_MIN}px + ${countries.length + 1} * var(--space-5) + 2 * var(--space-6)))`
	);

	// The one table's columns: the year, one per jurisdiction, the total. A
	// phone keeps the year and the total; the jurisdictions are what the open
	// year's cards say.
	const tableColumns = $derived<Column[]>([
		{ key: 'year', label: 'Year', width: `${YEAR}px` },
		...countries.map((c) => ({
			key: `country:${c.code}`,
			label: c.name,
			align: 'end' as const,
			width: `minmax(${COUNTRY_MIN}px, 1fr)`,
			hideBelow: 760 as const
		})),
		{ key: 'total', label: `Year total · ${symbol}`, align: 'end', width: `${TOTAL}px` }
	]);
	const byYear = $derived(new Map(rows.map((r) => [String(r.year), r])));
	const tableGroups = $derived<Group<{ year: number }>[]>(
		rows.map((r) => ({
			key: String(r.year),
			open: openYear === r.year,
			rows: openYear === r.year ? [{ year: r.year }] : []
		}))
	);
</script>

<div class="matrix" style:--row-cols={columns} style:--row-min={minWidth}>
	{#if ordered.length > LIST_PAGE_SIZES[0]}
		<!-- Above the rows it sizes: how much to show is a decision made before
		     reading, while which page to read is one made after. -->
		<div class="tools">
			<PageSize bind:size onchange={() => (page = 0)} label="years" />
		</div>
	{/if}

	<DataTable
		columns={tableColumns}
		groups={tableGroups}
		hue="--teal"
		label="Tax by year"
		rowKey={(r) => String(r.year)}
		ontoggle={(key) => onToggle(Number(key))}
		rowLayout="block"
	>
		{#snippet summary(visible)}
			<span class="f-cell">All</span>
			{#each perCountry as f (f.code)}
				{#if visible.has(`country:${f.code}`)}
					<span class="f-cell right">
						<span class="mono">{compactMinor(f.grossMinor, currency)}</span>
						<span class="c-rate">{f.count} {f.count === 1 ? 'year' : 'years'}</span>
					</span>
				{/if}
			{/each}
			<span class="f-cell right">
				<span class="c-rate">{blended === null ? '—' : `${blended.toFixed(2)}%`}</span>
				<span class="display t-value">{formatMinor(totalGross, currency)}</span>
			</span>
		{/snippet}

		{#snippet head(group, visible)}
			{@const row = byYear.get(group.key)!}
			<span class="year mono">
				<span class="chevron" class:open={group.open}>{group.open ? '▼' : '▶'}</span>
				{row.year}
			</span>

			{#each countries as c (c.code)}
				{#if visible.has(`country:${c.code}`)}
					{@const cell = cellFor(row, c.code)}
					<span class="cell right" class:flagged={cell && flagged(cell.grossMinor)}>
						{#if cell}
							<span class="mono c-gross">{compactMinor(BigInt(cell.grossMinor), currency)}</span>
							<span class="c-rate">
								{#if flagged(cell.grossMinor)}⚠{/if}
								{cell.ratePct === null ? '—' : `${cell.ratePct.toFixed(2)}%`}
							</span>
						{:else}
							<!-- Not an em dash and not 0: no filing means "lived elsewhere
							     that year", which is a different thing from earning nothing. -->
							<span class="absent">·</span>
						{/if}
					</span>
				{/if}
			{/each}

			<span class="cell right total">
				<span class="c-rate">{row.ratePct === null ? '—' : `${row.ratePct.toFixed(2)}%`}</span>
				<span class="display t-value">{formatMinor(BigInt(row.grossMinor), currency)}</span>
				<!-- The magnitude bar lives ONLY here. This is the one column where
				     every row is in the same currency, so the only one where
				     comparing bar lengths is honest. -->
				<span class="track">
					<span
						class="fill"
						style:width="{ceiling === 0n
							? 0
							: Math.max(2, (Number(BigInt(row.grossMinor)) / Number(ceiling)) * 100)}%"
					></span>
				</span>
			</span>
		{/snippet}

		{#snippet row(r)}
			{#if detail}{@render detail(r.year)}{/if}
		{/snippet}

		{#snippet foot()}
			{#if ordered.length > LIST_PAGE_SIZES[0]}
				<ListPager bind:page {pages} range={pageRange} />
			{/if}
		{/snippet}
	</DataTable>
</div>

<style>
	.matrix {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.tools {
		display: flex;
		justify-content: flex-end;
	}
	.right {
		text-align: right;
	}
	.year {
		font-size: var(--text-lg);
		color: var(--fg1);
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.chevron {
		font-size: 9px;
		color: var(--fg3);
	}
	.chevron.open {
		color: var(--teal);
	}
	.cell,
	.f-cell {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.cell.right,
	.f-cell.right {
		align-items: flex-end;
	}
	.f-cell {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.c-gross {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.c-rate {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.cell.flagged .c-gross,
	.cell.flagged .c-rate {
		color: var(--yellow);
	}
	.absent {
		color: var(--bd2);
	}
	.t-value {
		font-size: var(--text-lg);
		color: var(--fg1);
	}
	.total .t-value {
		font-size: var(--text-xl);
	}
	.track {
		width: 100%;
		height: 3px;
		background: var(--card3);
		border-radius: var(--radius-xs);
		overflow: hidden;
		margin-top: 3px;
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--teal);
	}
</style>
