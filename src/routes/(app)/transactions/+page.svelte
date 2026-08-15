<script lang="ts">
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import SplitDialog from '$lib/components/SplitDialog.svelte';
	import TagInput from '$lib/components/TagInput.svelte';

	let { data, form } = $props();

	const REVIEW_LABELS: Record<string, string> = {
		auto: 'filed by rule',
		needs_review: 'needs a look',
		confirmed: 'confirmed'
	};

	type Row = (typeof data.rows)[number];
	let splitting = $state<Row | null>(null);
</script>

<ScreenHeader
	emoji="📒"
	title="Transactions"
	caption="Every row the ledger holds. Search it, narrow it, file what the rules missed."
/>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<section class="section">
	<form method="GET" class="card filters">
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
		<span class="eyebrow-caption filter-total">
			{data.total}
			{data.total === 1 ? 'transaction' : 'transactions'}
			{#if data.totals.length > 0}
				· {data.totals.map((t) => `${t.amount} ${t.currency}`).join(' · ')}
			{/if}
		</span>
	</div>

	{#if data.rows.length === 0}
		<p class="empty">Nothing matches. Widen the dates, or clear the filters.</p>
	{/if}

	{#each data.rows as r (r.id)}
		<div class="card txn-row">
			<div class="r-facts">
				<span class="mono r-date">{r.date}</span>
				<div class="r-mid">
					<span class="r-merchant">{r.merchant}</span>
					<span class="r-reason">
						{r.account}
						{#if r.detail}· {r.detail}{/if}
						{#if r.isTransfer}· own transfer{/if}
					</span>
				</div>
				<span class="mono r-amount" style:color={r.negative ? 'var(--fg1)' : 'var(--green)'}>
					{r.amount}
				</span>
			</div>
			<div class="r-actions">
				<span class="r-state">{r.isSplit ? 'split' : REVIEW_LABELS[r.reviewState]}</span>
				{#if r.isSplit}
					<!-- A split transaction has no single category, so there is nothing
					     for the categoriser to learn: the File control does not apply. -->
					<button type="button" class="btn" onclick={() => (splitting = r)}>Edit split</button>
					<form method="POST" action="?/unsplit" use:enhance>
						<input type="hidden" name="id" value={r.id} />
						<button type="submit" class="btn">Remove split</button>
					</form>
				{:else}
					<form method="POST" action="?/file" use:enhance class="cat-form">
						<input type="hidden" name="id" value={r.id} />
						<select name="categoryId">
							<!-- An unfiled row must not look filed, so the prompt holds the
							     selection until someone actually picks something. -->
							<option value="" disabled selected={r.categoryId === null}>File as…</option>
							{#each data.categories as group (group.key)}
								<optgroup label={group.label}>
									{#each group.items as c (c.id)}
										<option value={c.id} selected={r.categoryId === c.id}>{c.name}</option>
									{/each}
								</optgroup>
							{/each}
						</select>
						<button type="submit" class="btn">File</button>
					</form>
					<button type="button" class="btn" onclick={() => (splitting = r)}>Split</button>
				{/if}
			</div>

			{#if r.isSplit}
				<ul class="splits">
					{#each r.splits as s (s.id)}
						<li class="split-line">
							<span class="s-category">{s.categoryLabel ?? 'Uncategorised'}</span>
							{#if s.tags.length > 0}
								<span class="s-note">{s.tags.map((tag) => `#${tag.name}`).join(' · ')}</span>
							{/if}
							{#if s.note}<span class="s-note">{s.note}</span>{/if}
							<span class="mono s-amount">{s.amount}</span>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="r-tags">
				{#each r.tags as t (t.id)}
					{#if t.direct}
						<form method="POST" action="?/tags" use:enhance class="tag-chip">
							<input type="hidden" name="id" value={r.id} />
							<input type="hidden" name="removeTag" value={t.name} />
							<span>{t.name}</span>
							<button type="submit" aria-label="Remove tag {t.name}">✕</button>
						</form>
					{:else}
						<span class="tag-chip" title="This tag belongs to a split line">{t.name}</span>
					{/if}
				{/each}
				<form method="POST" action="?/tags" use:enhance class="tag-form">
					<input type="hidden" name="id" value={r.id} />
					<TagInput transactionId={r.id} known={data.knownTags} />
				</form>
			</div>
		</div>
	{/each}

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

	{#if data.pageCount > 1}
		<div class="pager">
			<a class="btn" class:disabled={data.filter.page <= 1} href={data.prevHref}>← Newer</a>
			<span class="mono">Page {data.filter.page} of {data.pageCount}</span>
			<a class="btn" class:disabled={data.filter.page >= data.pageCount} href={data.nextHref}>
				Older →
			</a>
		</div>
	{/if}
</section>

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.filters {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		color: var(--fg3);
	}
	.filters input,
	.filters select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
	}
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
		gap: 8px;
		align-items: center;
	}
	/* The row mirrors the import review row, so the same transaction reads the
	   same way on both screens — only the actions differ. */
	.txn-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
	}
	.r-facts {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr) auto;
		gap: 12px;
		align-items: baseline;
		flex: 1 1 380px;
		min-width: 0;
	}
	.r-date {
		font-size: 12px;
		color: var(--fg3);
	}
	.r-mid {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.r-merchant {
		font-size: 13.5px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.r-reason {
		font-size: 12px;
		color: var(--fg3);
	}
	.r-amount {
		font-size: 14px;
		white-space: nowrap;
	}
	.r-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.r-state {
		font-size: 12px;
		color: var(--fg3);
	}
	.cat-form {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.r-actions select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 7px 11px;
		font-size: 13px;
	}
	/* The lines of a split, shown under the transaction they divide. */
	.splits {
		flex-basis: 100%;
		list-style: none;
		margin: 0;
		padding: 10px 0 0;
		border-top: 1px solid var(--bd);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.split-line {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr) auto;
		gap: 12px;
		align-items: baseline;
		font-size: 13px;
	}
	.s-category {
		grid-column: 2;
	}
	.s-note {
		grid-column: 2;
		font-size: 12px;
		color: var(--fg3);
	}
	.s-amount {
		font-size: 13px;
		color: var(--fg2);
		white-space: nowrap;
	}
	.r-tags {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid var(--bd2);
		border-radius: 999px;
		padding: 3px 5px 3px 10px;
		font-size: 12px;
		color: var(--fg2);
	}
	.tag-chip button {
		border: 0;
		background: none;
		color: var(--fg3);
		cursor: pointer;
		font-size: 11px;
		padding: 0 3px;
	}
	.tag-chip button:hover {
		color: var(--fg1);
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		font-size: 12px;
		color: var(--fg3);
	}
	.pager .disabled {
		opacity: 0.4;
		pointer-events: none;
	}
	.empty {
		color: var(--fg3);
		font-size: 13px;
	}
	@media (max-width: 640px) {
		.r-facts {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.r-date {
			grid-column: 1 / -1;
		}
		.f-wide {
			grid-column: auto;
		}
	}
</style>
