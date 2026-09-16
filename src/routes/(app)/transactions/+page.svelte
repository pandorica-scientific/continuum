<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Two independent pagers: months page in local state, the open month's
	// transactions page via the URL since they're fetched per month.
	import { deserialize } from '$app/forms';
	import { page } from '$app/state';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import ControlRow from '$lib/components/ControlRow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Field from '$lib/components/Field.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import ListPager from '$lib/components/ListPager.svelte';
	import PageSize, {
		DEFAULT_LIST_PAGE_SIZE,
		LIST_PAGE_SIZES
	} from '$lib/components/PageSize.svelte';
	import type { Column, Group } from '$lib/components/data-table';
	import ReceiptsDialog from '$lib/components/ReceiptsDialog.svelte';
	import SplitDialog from '$lib/components/SplitDialog.svelte';
	import TransactionRow from '$lib/components/TransactionRow.svelte';
	import { REVIEW_LABELS } from '$lib/transactions/filter';
	// Type only — erased at compile time, so the server module is never pulled
	// into the browser bundle.
	import type { CandidateDocument } from '$lib/server/documents/targets';

	let { data, form } = $props();

	type Row = (typeof data.rows)[number];
	type Month = (typeof data.months)[number];
	let splitting = $state<Row | null>(null);

	// Month list pages locally, like Tax and Salary. The page follows the open
	// month only when it CHANGES, so paging away manually still works.
	let monthSize = $state<number>(DEFAULT_LIST_PAGE_SIZE);
	let monthPage = $state(0);
	const monthPages = $derived(Math.max(1, Math.ceil(data.months.length / monthSize)));
	$effect(() => {
		if (monthPage > monthPages - 1) monthPage = 0;
	});
	let followedOpen: string | null = null;
	$effect(() => {
		if (data.openMonth === followedOpen) return;
		followedOpen = data.openMonth;
		if (!data.openMonth) return;
		const index = data.months.findIndex((m) => m.month === data.openMonth);
		if (index >= 0) monthPage = Math.floor(index / monthSize);
	});
	const monthWindow = $derived(
		data.months.slice(monthPage * monthSize, monthPage * monthSize + monthSize)
	);
	const monthRange = $derived(
		monthWindow.length === 0
			? ''
			: monthWindow.length === 1
				? monthWindow[0].month
				: `${monthWindow.at(-1)!.month} – ${monthWindow[0].month}`
	);

	// Flexible columns carry a minimum so a heading is never squeezed narrower
	// than the word it prints. A phone keeps only month and net — the bar on
	// net already says in against out.
	const COLUMNS: Column[] = [
		{ key: 'month', label: 'Month', width: 'minmax(190px, 1.4fr)' },
		{ key: 'in', label: 'In', align: 'end', width: 'minmax(120px, 1fr)', hideBelow: 760 },
		{ key: 'out', label: 'Out', align: 'end', width: 'minmax(120px, 1fr)', hideBelow: 760 },
		{ key: 'net', label: 'Net', align: 'end', width: 'minmax(150px, 210px)' }
	];
	const monthByKey = $derived(new Map(data.months.map((m) => [m.month, m])));
	const groups = $derived<Group<Row>[]>(
		monthWindow.map((m) => ({
			key: m.month,
			open: m.month === data.openMonth,
			rows: m.month === data.openMonth ? data.rows : []
		}))
	);
	const monthOf = (group: Group<Row>): Month => monthByKey.get(group.key)!;

	// Local, not the URL — a month's rows are already loaded, so opening one needs no fetch.
	let openRow = $state<string | null>(null);
	// Guarded on the month CHANGING, not on `data`: every form action here
	// replaces the load, and filing a category must not collapse its own row.
	let followedMonth: string | null = null;
	$effect(() => {
		if (data.openMonth === followedMonth) return;
		followedMonth = data.openMonth;
		openRow = null;
	});

	// Dialog rather than a per-row file input. Held by id, not the row object —
	// `data` is replaced when the attach action returns, and a captured row
	// would keep showing stale attachments.
	let attachingId = $state<string | null>(null);
	const attaching = $derived(
		attachingId ? (data.rows.find((r) => r.id === attachingId) ?? null) : null
	);

	// Fetched via `?/candidates` only for the one open dialog, rather than
	// computed by `load` for every row the register can page up to fifty of.
	let candidates = $state<CandidateDocument[]>([]);
	// Set on anything but a clean success (dropped connection, CSRF refusal, a
	// 500 — all throw out of `deserialize` the same way). `null` means nothing
	// tried yet, not nothing wrong.
	let candidatesError = $state<string | null>(null);
	// True only while the request is in flight, so the dialog shows a loading
	// state instead of an empty picker that then pops a list in.
	let loadingCandidates = $state(false);
	$effect(() => {
		const id = attachingId;
		// Re-read on this row's own documents changing too, so an attach or
		// delete elsewhere doesn't leave a stale list.
		void attaching?.documents;
		if (!id) {
			candidates = [];
			candidatesError = null;
			loadingCandidates = false;
			return;
		}
		let cancelled = false;
		loadingCandidates = true;
		candidatesError = null;
		(async () => {
			try {
				const body = new FormData();
				body.set('targetId', id);
				const response = await fetch('?/candidates', {
					method: 'POST',
					body,
					headers: { 'x-sveltekit-action': 'true' }
				});
				if (cancelled) return;
				const result = deserialize(await response.text());
				if (cancelled) return;
				if (result.type === 'success') {
					candidates = (result.data?.candidates as CandidateDocument[] | undefined) ?? [];
					candidatesError = null;
				} else {
					candidates = [];
					candidatesError = 'Could not load the documents you could attach.';
				}
			} catch {
				if (!cancelled) {
					candidates = [];
					candidatesError = 'Could not load the documents you could attach.';
				}
			} finally {
				if (!cancelled) loadingCandidates = false;
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	// Links, not form controls, so the register's whole state stays in the URL
	// and a narrowed view remains shareable.
	interface QuickChip {
		label: string;
		hue: string;
		/** Params to set; a null value removes the key. */
		params: Record<string, string | null>;
		on: (filter: typeof data.filter) => boolean;
	}
	const QUICK: QuickChip[] = [
		{
			label: 'All',
			hue: '--fg3',
			params: { review: null, dir: null },
			on: (f) => !f.reviewState && (!f.direction || f.direction === 'any')
		},
		{
			label: 'Needs a look',
			hue: '--yellow',
			params: { review: 'needs_review', dir: null },
			on: (f) => f.reviewState === 'needs_review'
		},
		{
			label: 'Money in',
			hue: '--green',
			params: { dir: 'in', review: null },
			on: (f) => f.direction === 'in'
		},
		{
			label: 'Money out',
			hue: '--red',
			params: { dir: 'out', review: null },
			on: (f) => f.direction === 'out'
		}
	];

	// Built as a string rather than by mutating URLSearchParams — the lint rule
	// reserves the mutable class for reactive state.
	function quickHref(params: Record<string, string | null>): string {
		const touched = new Set(Object.keys(params));
		const pairs = [...page.url.searchParams.entries()]
			// A narrowing always lands on page one — the old page number means a different result set.
			.filter(([key]) => key !== 'page' && !touched.has(key))
			.concat(
				Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== null)
			);
		const query = pairs
			.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
			.join('&');
		return query ? `?${query}` : '/transactions';
	}

	// Everything the search box must not drop when it submits on its own.
	const carried = $derived(
		[...page.url.searchParams.entries()].filter(([key]) => key !== 'q' && key !== 'page')
	);

	// Open when something in the grid is already narrowing the view, so a filter
	// that is in force is never invisible.
	let showFilters = $state(false);
	$effect(() => {
		if (
			data.filter.from ||
			data.filter.to ||
			data.filter.accountId ||
			data.filter.categoryId ||
			data.filter.minMinor ||
			data.filter.maxMinor ||
			data.filter.sourceMethod ||
			data.filter.includeTransfers
		) {
			showFilters = true;
		}
	});

	const rowFrom = $derived((data.filter.page - 1) * data.pageSize + 1);
	const rowTo = $derived(Math.min(data.monthTotal, data.filter.page * data.pageSize));
</script>

<ScreenHeader
	title="Transactions"
	caption="Every row the ledger holds. Search it, narrow it, file what the rules missed."
/>

{#if form?.message && !form?.id}
	<!-- Failures naming a row render beside that row; showing the same message here too would look like two failures. -->
	<div class="error">{form.message}</div>
{/if}

<!-- Chips and search cover most visits; the full filter grid stays one click away. -->
<ControlRow>
	{#snippet left()}
		<form method="GET" class="quick-search">
			{#each carried as [key, value] (key)}
				<input type="hidden" name={key} {value} />
			{/each}
			<label class="search">
				<Icon name="search" size={15} />
				<input
					type="search"
					name="q"
					value={data.filter.search ?? ''}
					placeholder="Search transactions"
					aria-label="Search transactions"
				/>
			</label>
		</form>
		<div class="chips-row" role="group" aria-label="Quick filters">
			{#each QUICK as chip (chip.label)}
				<a
					class="chip"
					class:on={chip.on(data.filter)}
					aria-current={chip.on(data.filter) ? 'true' : undefined}
					style:--chip-hue="var({chip.hue})"
					href={quickHref(chip.params)}
				>
					{chip.label}
				</a>
			{/each}
		</div>
	{/snippet}
	{#snippet right()}
		<button
			type="button"
			class="btn"
			aria-expanded={showFilters}
			onclick={() => (showFilters = !showFilters)}
		>
			<Icon name="sliders" size={15} />
			More filters
		</button>
	{/snippet}
</ControlRow>

<section class="section" hidden={!showFilters}>
	<form method="GET" class="card filters">
		<!-- A GET form submits only its own fields, so page size is carried explicitly, and only when it differs from the default. -->
		{#if data.pageSize !== data.defaultPageSize}
			<input type="hidden" name="per" value={data.pageSize} />
		{/if}
		<!-- Carries the group filter (set from cash-flow chart navigation) since the grid below has no control for it. -->
		{#if data.filter.groupKey}
			<input type="hidden" name="group" value={data.filter.groupKey} />
			<div class="active-filters">
				<span class="chip">
					<span>Group: {data.groupLabel}</span>
					<a class="chip-x" href={data.clearGroupHref} aria-label="Clear the group filter">✕</a>
				</span>
			</div>
		{/if}
		<div class="grid">
			<label class="f-wide">
				<span>Search</span>
				<input name="q" value={data.filter.search ?? ''} placeholder="counterparty, note, symbol" />
			</label>
			<label>
				<span>From</span>
				<input type="date" name="from" value={data.filter.from ?? ''} />
			</label>
			<label>
				<span>To</span>
				<input type="date" name="to" value={data.filter.to ?? ''} />
			</label>
			<label>
				<span>Account</span>
				<select name="account">
					<option value="">All accounts</option>
					{#each data.accounts as a (a.id)}
						<option value={a.id} selected={data.filter.accountId === a.id}>{a.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Category</span>
				<select name="category">
					<option value="">Any category</option>
					<option value="none" selected={data.filter.categoryId === 'none'}>Uncategorised</option>
					{#each data.categories as group (group.key)}
						<optgroup label={group.label}>
							{#each group.items as c (c.id)}
								<option value={c.id} selected={data.filter.categoryId === c.id}>{c.name}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</label>
			<label>
				<span>Direction</span>
				<select name="dir">
					<option value="any">In and out</option>
					<option value="in" selected={data.filter.direction === 'in'}>Money in</option>
					<option value="out" selected={data.filter.direction === 'out'}>Money out</option>
				</select>
			</label>
			<label>
				<span>Min {data.baseCurrency}</span>
				<input name="min" value={data.filter.minMinor} inputmode="decimal" placeholder="0" />
			</label>
			<label>
				<span>Max {data.baseCurrency}</span>
				<input name="max" value={data.filter.maxMinor} inputmode="decimal" placeholder="∞" />
			</label>
			<label>
				<span>State</span>
				<select name="review">
					<option value="">Any state</option>
					{#each data.reviewStates as state (state)}
						<option value={state} selected={data.filter.reviewState === state}>
							{REVIEW_LABELS[state]}
						</option>
					{/each}
				</select>
			</label>
			<Field label="Read as">
				<select name="source">
					<option value="">However it was read</option>
					{#each data.sourceMethods as method (method.value)}
						<option value={method.value} selected={data.filter.sourceMethod === method.value}>
							{method.label}
						</option>
					{/each}
				</select>
			</Field>
			<label class="f-check">
				<input type="checkbox" name="transfers" value="1" checked={data.filter.includeTransfers} />
				<span>Show own transfers</span>
			</label>
		</div>
		<div class="f-actions">
			<button type="submit" class="btn btn-primary">Apply</button>
			<a class="btn" href="/transactions">Clear</a>
		</div>
	</form>
</section>

<section class="section">
	<div class="eyebrow-row">
		<Eyebrow hue="--teal" icon="ledger" label="Matching" />
		<span class="eyebrow-caption">
			{data.total}
			{data.total === 1 ? 'transaction' : 'transactions'} · the newest month is open
		</span>
	</div>

	{#if data.months.length > LIST_PAGE_SIZES[0]}
		<!-- Above the rows it sizes — how much to show comes before which page to read. -->
		<div class="tools">
			<PageSize bind:size={monthSize} onchange={() => (monthPage = 0)} label="months" />
		</div>
	{/if}

	<DataTable
		columns={COLUMNS}
		{groups}
		hue="--teal"
		label="Transactions by month"
		rowKey={(r) => r.id}
		href={(group) => monthOf(group).href}
		rowLayout="block"
	>
		{#snippet summary(visible)}
			<span class="f-cell">
				<span class="f-label">All</span>
				<span class="c-sub">
					{data.months.length}
					{data.months.length === 1 ? 'month' : 'months'} · {data.total}
					{data.total === 1 ? 'transaction' : 'transactions'}
				</span>
			</span>
			{#if visible.has('in')}
				<span class="f-cell right">
					{#each data.totals as t (t.currency)}
						<span class="mono in">{t.in}</span>
					{/each}
				</span>
			{/if}
			{#if visible.has('out')}
				<span class="f-cell right">
					{#each data.totals as t (t.currency)}
						<span class="mono out">{t.out}</span>
					{/each}
				</span>
			{/if}
			<span class="f-cell right">
				{#each data.totals as t (t.currency)}
					<span class="net-line">
						<span class="c-sub">{t.currency}</span>
						<span class="display t-value" class:short={t.negative}>{t.net}</span>
					</span>
				{/each}
			</span>
		{/snippet}

		{#snippet head(group, visible)}
			{@const m = monthOf(group)}
			<span class="month">
				<!-- 34px tile, not a bare glyph — at 9px the chevron wasn't a usable target. -->
				<span class="chevron" class:open={group.open} aria-hidden="true"
					>{group.open ? '▾' : '▸'}</span
				>
				<span class="m-name">
					<span class="m-label">{m.label}</span>
					<span class="c-sub">
						{m.count}
						{m.count === 1 ? 'transaction' : 'transactions'}
					</span>
				</span>
			</span>
			{#if visible.has('in')}
				<span class="cell right">
					{#each m.currencies as c (c.currency)}
						<span class="mono c-value in">{c.in}</span>
					{/each}
				</span>
			{/if}
			{#if visible.has('out')}
				<span class="cell right">
					{#each m.currencies as c (c.currency)}
						<span class="mono c-value out">{c.out}</span>
					{/each}
				</span>
			{/if}
			<span class="cell right net">
				{#each m.currencies as c (c.currency)}
					<span class="net-line">
						<span class="c-sub">{c.currency}</span>
						<span class="display t-value" class:short={c.negative}>{c.net}</span>
					</span>
					<!-- In vs out, scaled against the widest month in the same currency. -->
					<span class="track" aria-hidden="true">
						<span class="fill in" style:width="{c.inPct}%"></span>
						<span class="fill out" style:width="{c.outPct}%"></span>
					</span>
				{/each}
			</span>
		{/snippet}

		{#snippet aside(group)}
			{#if data.rows.length === 0}
				<span class="empty-month">Nothing in {monthOf(group).label} matches the filters above.</span
				>
			{/if}
			<!-- Links, not a posting control — page size lives in the URL like the rest of this view. -->
			<span class="per-page" role="group" aria-label="Transactions per page">
				{#each data.pageSizes as p (p.size)}
					<a
						class="per"
						class:active={p.active}
						href={p.href}
						data-sveltekit-noscroll
						aria-current={p.active ? 'true' : undefined}
					>
						{p.size}
					</a>
				{/each}
			</span>
			<span class="mono range">
				{#if data.monthTotal > 0}
					{rowFrom}–{rowTo} of {data.monthTotal}
				{/if}
			</span>
			{#if data.pageCount > 1}
				<span class="nav">
					<a
						class="btn small"
						class:disabled={data.filter.page <= 1}
						href={data.prevHref}
						data-sveltekit-noscroll>← Newer</a
					>
					<span class="mono">Page {data.filter.page} of {data.pageCount}</span>
					<a
						class="btn small"
						class:disabled={data.filter.page >= data.pageCount}
						href={data.nextHref}
						data-sveltekit-noscroll>Older →</a
					>
				</span>
			{/if}
		{/snippet}

		{#snippet row(r)}
			<TransactionRow
				row={r}
				categories={data.categories}
				loans={data.loans}
				knownTags={data.knownTags}
				proofLabel={r.proofClass ? data.proofLabels[r.proofClass] : null}
				open={openRow === r.id}
				error={form?.id === r.id ? (form.message ?? null) : null}
				ontoggle={() => (openRow = openRow === r.id ? null : r.id)}
				onsplit={() => (splitting = r)}
				onreceipts={() => (attachingId = r.id)}
			/>
		{/snippet}

		{#snippet empty()}
			Nothing matches. Widen the dates, or clear the filters.
		{/snippet}

		{#snippet foot()}
			{#if data.months.length > LIST_PAGE_SIZES[0]}
				<ListPager bind:page={monthPage} pages={monthPages} range={monthRange} />
			{/if}
		{/snippet}
	</DataTable>

	{#if splitting}
		<!-- Keyed so the editor always remounts with the row it was opened for,
		     rather than keeping the previous row's lines in its state. -->
		{#key splitting.id}
			<SplitDialog
				transactionId={splitting.id}
				merchant={splitting.merchant}
				amountMajor={splitting.amountMajor}
				currency={splitting.currency}
				categories={data.categories}
				existing={splitting.splits.map((s) => ({
					id: s.id,
					amountMajor: s.amountMajor,
					categoryId: s.categoryId,
					tagNames: s.tags.map((tag) => tag.name).join(', ')
				}))}
				knownTags={data.knownTags}
				onclose={() => (splitting = null)}
			/>
		{/key}
	{/if}

	{#if attaching}
		<ReceiptsDialog
			transaction={attaching}
			{candidates}
			{candidatesError}
			{loadingCandidates}
			formMessage={form?.message && form?.id === attaching.id ? form.message : null}
			onclose={() => (attachingId = null)}
		/>
	{/if}
</section>

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.quick-search {
		display: contents;
	}
	.search {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex: 1 1 220px;
		min-width: 0;
		max-width: 320px;
		height: 38px;
		padding: 0 var(--space-6);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-ctl);
		background: var(--card);
		color: var(--fg3);
	}
	.search input {
		border: 0;
		background: none;
		padding: 0;
		min-height: 0;
		flex: 1;
		min-width: 0;
		color: var(--fg1);
	}
	.search input:focus {
		outline: none;
	}
	.search:focus-within {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
	.chips-row {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.chips-row .chip {
		display: inline-flex;
		align-items: center;
		height: 32px;
		padding: 0 var(--space-6);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		background: var(--card);
		color: var(--fg2);
		font-size: var(--text-sm);
		white-space: nowrap;
		transition:
			background-color var(--dur) var(--ease),
			border-color var(--dur) var(--ease);
	}
	.chips-row .chip:hover {
		background: var(--surface-2);
		text-decoration: none;
	}
	.chips-row .chip.on {
		background: color-mix(in srgb, var(--chip-hue) 16%, transparent);
		border-color: color-mix(in srgb, var(--chip-hue) 45%, transparent);
		color: var(--fg1);
		font-weight: 600;
	}
	.filters {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-6);
	}
	/* Scoped to the filter grid — bare, this also caught the search box above. */
	.filters label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.filters input,
	.f-wide {
		grid-column: span 2;
	}
	.f-check {
		flex-direction: row;
		align-items: center;
		gap: 7px;
		align-self: end;
		padding-bottom: 8px;
	}
	.f-check input {
		width: auto;
	}
	.f-actions {
		display: flex;
		gap: var(--space-4);
		align-items: center;
	}
	/* Named for what it holds, not the state — a bare `.active` also matched the page-size link's own rule. */
	.active-filters {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		background: var(--card2);
		padding: 3px 11px;
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.chip-x {
		color: var(--fg3);
		line-height: 1;
		text-decoration: none;
	}
	.chip-x:hover {
		color: var(--fg1);
		text-decoration: none;
	}
	.tools {
		display: flex;
		justify-content: flex-end;
	}
	.empty-month {
		margin-right: auto;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* The month row's cells — read the same in both the head row and the summary row. */
	.month {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
	}
	.m-name,
	.f-cell,
	.cell {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.f-cell {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.f-label {
		font-size: var(--text-lg);
		color: var(--fg1);
	}
	.right {
		align-items: flex-end;
		text-align: right;
	}
	.m-label {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
	}
	.chevron {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: var(--radius-lg);
		background: var(--surface-2);
		color: var(--fg3);
		font-size: var(--text-sm);
		flex: none;
		transition:
			background-color var(--dur) var(--ease),
			color var(--dur) var(--ease);
	}
	.chevron.open {
		background: color-mix(in srgb, var(--teal) var(--tile-alpha-active), transparent);
		color: var(--teal);
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
		font-size: var(--text-lg);
		color: var(--fg1);
	}
	/* Red only when the month ran short — colouring every month would lose the exception. */
	.t-value.short {
		color: var(--red);
	}
	.track {
		display: flex;
		width: 120px;
		max-width: 100%;
		height: 3px;
		border-radius: var(--radius-xs);
		background: var(--bd2);
		margin-top: var(--space-2);
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
	.range {
		font-size: var(--text-xs);
	}
	.nav {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		margin-left: auto;
		font-size: var(--text-sm);
	}
	.nav .disabled {
		opacity: 0.4;
		pointer-events: none;
	}
	.per-page {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		overflow: hidden;
	}
	.per {
		font-size: var(--text-xs);
		color: var(--fg3);
		text-decoration: none;
		padding: 3px 9px;
	}
	.per + .per {
		border-left: 1px solid var(--bd);
	}
	.per:hover {
		color: var(--fg1);
		text-decoration: none;
	}
	.per.active {
		background: var(--card2);
		color: var(--fg1);
	}
	@media (max-width: 640px) {
		.f-wide {
			grid-column: auto;
		}
	}
</style>
