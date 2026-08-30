<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// The register, as a table of months you open rather than a run of cards.
	//
	// It used to be a flat list of transactions, ten to a page, each card
	// carrying every control that row has. That made two jobs fight each other:
	// reading the ledger, which wants a scannable list, and correcting it, which
	// wants controls. So the months collapse, a month opens into its
	// transactions, and a transaction opens into everything you can do to it —
	// the same three tiers the Tax and Salary screens are built on.
	//
	// The two pagers are independent. MonthMatrix walks months in local state;
	// the transactions inside the open month are paged by the URL, because they
	// are fetched a month at a time. Paging one leaves the other where it was.
	import { deserialize } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Field from '$lib/components/Field.svelte';
	import MonthMatrix from '$lib/components/MonthMatrix.svelte';
	import ReceiptsDialog from '$lib/components/ReceiptsDialog.svelte';
	import SplitDialog from '$lib/components/SplitDialog.svelte';
	import TransactionRow from '$lib/components/TransactionRow.svelte';
	import { REVIEW_LABELS } from '$lib/transactions/filter';
	// Type only — erased at compile time, so the server module is never pulled
	// into the browser bundle.
	import type { CandidateDocument } from '$lib/server/documents/targets';

	let { data, form } = $props();

	type Row = (typeof data.rows)[number];
	let splitting = $state<Row | null>(null);

	// Which transaction is expanded. Local, not the URL: a month's rows are
	// already on the page, so opening one asks the server for nothing — and the
	// month, which does need a fetch, is the thing worth being able to link to.
	let openRow = $state<string | null>(null);
	// A different month is a different set of rows; carrying an id across would
	// leave a row expanded that nobody can see. Guarded on the month CHANGING
	// rather than on `data`: every form action on this screen replaces the load,
	// and filing a category must not collapse the row it was filed from.
	let followedMonth: string | null = null;
	$effect(() => {
		if (data.openMonth === followedMonth) return;
		followedMonth = data.openMonth;
		openRow = null;
	});

	// Receipts open in a dialog rather than sitting under every row: a file input
	// and its chips took a whole line per transaction, on a page that is nothing
	// but transactions. Held by id, not by the row object — `data` is replaced
	// when the attach action returns, and a captured row would keep showing the
	// attachments the page had before the upload.
	let attachingId = $state<string | null>(null);
	const attaching = $derived(
		attachingId ? (data.rows.find((r) => r.id === attachingId) ?? null) : null
	);

	// What "Attach existing" may offer, for the one transaction whose dialog is
	// open. `load` does not compute this for every row the register is paging
	// — up to fifty of them — because that would mean carrying the household's
	// whole visible document library once per row for the sake of the single
	// dialog a person might open. `?/candidates` asks for it only when there is
	// something open to ask it for.
	let candidates = $state<CandidateDocument[]>([]);
	// Set on anything but a clean success — a dropped connection and a
	// non-action response (a CSRF refusal page, a 500) both throw out of
	// `deserialize` the same way, and a person cannot tell those apart from
	// here either. Left as `null` is "nothing wrong", not "nothing tried yet".
	let candidatesError = $state<string | null>(null);
	// True only while the request above is in flight, so the dialog can say it
	// is checking rather than showing an empty picker that then pops a list
	// into it a moment later.
	let loadingCandidates = $state(false);
	$effect(() => {
		const id = attachingId;
		// Re-read whenever this row's own filed documents change too: an attach
		// or a delete both change what is already linked, and a stale list would
		// still offer what was just attached, or hide what was just removed.
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

	const rowFrom = $derived((data.filter.page - 1) * data.pageSize + 1);
	const rowTo = $derived(Math.min(data.monthTotal, data.filter.page * data.pageSize));
</script>

<ScreenHeader
	title="Transactions"
	caption="Every row the ledger holds. Search it, narrow it, file what the rules missed."
/>

{#if form?.message && !form?.id}
	<!-- Failures that name a row render beside that row instead; showing the same
	     message here as well reads as two separate failures. -->
	<div class="error">{form.message}</div>
{/if}

<section class="section">
	<form method="GET" class="card filters">
		<!-- A GET form submits its own fields and nothing else, so a chosen page
		     size would be dropped the moment anything was filtered. Only carried
		     when it differs from the default, to keep the URL clean. -->
		{#if data.pageSize !== data.defaultPageSize}
			<input type="hidden" name="per" value={data.pageSize} />
		{/if}
		<!-- Arriving from a stage of the cash-flow chart narrows the register to a
		     category group, and nothing in the grid below carries one — so Apply
		     would silently drop it. Stated rather than only carried, because a
		     narrowing nobody can see is a register that looks wrong. -->
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
		<Eyebrow emoji="📒" label="Matching" />
		<span class="eyebrow-caption">
			{data.total}
			{data.total === 1 ? 'transaction' : 'transactions'} · open a month to read it
		</span>
	</div>

	{#if data.months.length === 0}
		<p class="empty">Nothing matches. Widen the dates, or clear the filters.</p>
	{:else}
		<MonthMatrix
			months={data.months}
			openMonth={data.openMonth}
			totals={data.totals}
			total={data.total}
		>
			{#snippet detail(month)}
				<div class="rows">
					{#each data.rows as r (r.id)}
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
					{:else}
						<p class="empty-month">Nothing in {month} matches the filters above.</p>
					{/each}

					<div class="month-foot">
						<!-- Links, not a control that posts: every other part of this view
						     lives in the URL, so page size does too and a narrowed view
						     stays shareable at the size it was read in. -->
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
									class="btn"
									class:disabled={data.filter.page <= 1}
									href={data.prevHref}
									data-sveltekit-noscroll>← Newer</a
								>
								<span class="mono">Page {data.filter.page} of {data.pageCount}</span>
								<a
									class="btn"
									class:disabled={data.filter.page >= data.pageCount}
									href={data.nextHref}
									data-sveltekit-noscroll>Older →</a
								>
							</span>
						{/if}
					</div>
				</div>
			{/snippet}
		</MonthMatrix>
	{/if}

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
			isAdmin={data.isAdmin}
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
	label {
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
	/* What the register is narrowed to that no control in the grid states.
	   Named for what it holds rather than for the state it is in: a bare `.active`
	   also matched the selected page-size link, which has a rule of its own. */
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
	/* The open month's transactions, seated inside the table rather than in
	   cards of their own — the row above them is the thing they belong to.
	   `--row-min` is the matrix's and inherits down to here, so scrolling the
	   table sideways does not leave these rows ending short of the month row
	   above them. */
	.rows {
		background: var(--card);
		border-bottom: 1px solid var(--bd2);
		min-width: var(--row-min);
	}
	.empty-month {
		margin: 0;
		padding: var(--space-6);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.month-foot {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
		padding: 8px var(--space-6);
		border-top: 1px solid var(--bd2);
		font-size: var(--text-sm);
		color: var(--fg3);
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
	.empty {
		color: var(--fg3);
		font-size: var(--text-md);
	}
	@media (max-width: 640px) {
		.f-wide {
			grid-column: auto;
		}
	}
	/* The matrix stops scrolling sideways at this width and lays its months out
	   as rows instead, so the transactions under one must stop too. */
	@media (max-width: 720px) {
		.rows {
			min-width: 0;
		}
	}
</style>
