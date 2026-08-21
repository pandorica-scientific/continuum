<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import SplitDialog from '$lib/components/SplitDialog.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import Field from '$lib/components/Field.svelte';

	let { data, form } = $props();

	const REVIEW_LABELS: Record<string, string> = {
		auto: 'filed by rule',
		needs_review: 'needs a look',
		confirmed: 'confirmed'
	};

	type Row = (typeof data.rows)[number];
	let splitting = $state<Row | null>(null);

	// Categories picked since the page rendered, so Save can be disabled while
	// there is nothing to save. Deliberately NOT bind:value with a seeded record:
	// binding overrides the `selected` attributes below, and the server-rendered
	// markup then has nothing selected, so the browser falls back to the first
	// enabled option and an unfiled row reads as already filed with Salary.
	let chosen = $state<Record<string, string>>({});
	const picked = (r: { id: string; categoryId: string | null }) =>
		chosen[r.id] ?? r.categoryId ?? '';
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
						{#if r.isTransfer}·
							{r.transferKind === 'one-sided' ? 'own transfer (one side)' : 'own transfer'}{/if}
						{#if r.readAs}
							<!-- Only for readings whose structure was inferred. Every row
							     here still proved itself against the statement's balances;
							     this says where to start if a figure ever looks wrong. -->
							·
							<span class="r-read" title={r.proofClass ? data.proofLabels[r.proofClass] : undefined}
								>{r.readAs}</span
							>
						{/if}
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
						<select
							name="categoryId"
							onchange={(event) => (chosen[r.id] = event.currentTarget.value)}
						>
							<!-- An unfiled row must not look filed, so the prompt holds the
							     selection until someone actually picks something. -->
							<option value="" disabled selected={r.categoryId === null}>Choose a category…</option>
							{#each data.categories as group (group.key)}
								<optgroup label={group.label}>
									{#each group.items as c (c.id)}
										<option value={c.id} selected={r.categoryId === c.id}>{c.name}</option>
									{/each}
								</optgroup>
							{/each}
						</select>
						<!-- Disabled until something is chosen: the placeholder posts an empty
						     category, which the action rejects with a message that used to have
						     nowhere to appear. The row read as an unresponsive button. -->
						<button type="submit" class="btn" disabled={!picked(r)}>Save</button>
					</form>
					<button type="button" class="btn" onclick={() => (splitting = r)}>Split</button>
				{/if}
			</div>

			{#if form?.message && form?.id === r.id}
				<p class="row-error" role="alert">{form.message}</p>
			{/if}

			<!-- Receipts. The button next to the category picker says "Save" now, so
			     this is the control that genuinely attaches a file — which is what
			     the old "File" button was read as. -->
			<div class="r-docs">
				{#each r.documents as doc (doc.id)}
					<span class="doc-chip">
						{#if doc.storedName}
							<a href="/files/{doc.storedName}" target="_blank" rel="noopener">{doc.name}</a>
						{:else}
							<span>{doc.name}</span>
						{/if}
						<form method="POST" action="?/detachDocument" use:enhance>
							<input type="hidden" name="id" value={r.id} />
							<input type="hidden" name="documentId" value={doc.id} />
							<!-- Unlinks only. The document stays in Documents, because it
							     belongs to the household and not to this row. -->
							<button type="submit" aria-label="Detach {doc.name}">✕</button>
						</form>
					</span>
				{/each}
				<form
					method="POST"
					action="?/attachDocument"
					enctype="multipart/form-data"
					use:enhance
					class="attach-form"
				>
					<input type="hidden" name="id" value={r.id} />
					<input type="file" name="file" aria-label="Attach a receipt to this transaction" />
					<button type="submit" class="btn">Attach</button>
				</form>
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
	/* The row mirrors the import review row, so the same transaction reads the
	   same way on both screens — only the actions differ. */
	.txn-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
	}
	/* The card is a wrapping flex row, so a full basis is what puts the message
	   on its own line under the controls that produced it. */
	.r-docs {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}
	.doc-chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		padding: 3px 6px 3px 11px;
		font-size: var(--text-sm);
	}
	.doc-chip button {
		background: none;
		border: 0;
		color: var(--fg3);
		cursor: pointer;
		font-size: var(--text-xs);
		padding: 0 3px;
	}
	.attach-form {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		min-width: 0;
	}
	/* A file input's default width is far wider than its box and does not shrink,
	   which pushed the whole register into horizontal scroll at phone width. */
	.attach-form input[type='file'] {
		max-width: 100%;
		min-width: 0;
		flex: 1 1 12rem;
	}
	.doc-chip {
		max-width: 100%;
		min-width: 0;
	}
	.doc-chip a,
	.doc-chip > span {
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.row-error {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--text-sm);
		color: var(--red);
	}
	.r-facts {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr) auto;
		gap: var(--space-6);
		align-items: baseline;
		flex: 1 1 380px;
		min-width: 0;
	}
	.r-date {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.r-mid {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.r-merchant {
		font-size: var(--text-md);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.r-read {
		font-style: italic;
		opacity: 0.85;
	}

	.r-reason {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.r-amount {
		font-size: var(--text-lg);
		white-space: nowrap;
	}
	.r-actions {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.r-state {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.cat-form {
		display: flex;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.r-actions select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: var(--radius-md);
		padding: 7px 11px;
		font-size: var(--text-md);
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
		gap: var(--space-3);
	}
	.split-line {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr) auto;
		gap: var(--space-6);
		align-items: baseline;
		font-size: var(--text-md);
	}
	.s-category {
		grid-column: 2;
	}
	.s-note {
		grid-column: 2;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.s-amount {
		font-size: var(--text-md);
		color: var(--fg2);
		white-space: nowrap;
	}
	.r-tags {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		padding: 3px 5px 3px 10px;
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.tag-chip button {
		border: 0;
		background: none;
		color: var(--fg3);
		cursor: pointer;
		font-size: var(--text-xs);
		padding: 0 3px;
	}
	.tag-chip button:hover {
		color: var(--fg1);
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-7);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.pager .disabled {
		opacity: 0.4;
		pointer-events: none;
	}
	.empty {
		color: var(--fg3);
		font-size: var(--text-md);
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
