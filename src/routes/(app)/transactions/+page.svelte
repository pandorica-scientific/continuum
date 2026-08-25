<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import CategoryPicker from '$lib/components/CategoryPicker.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import SplitDialog from '$lib/components/SplitDialog.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import Field from '$lib/components/Field.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import Pill from '$lib/components/Pill.svelte';
	// Beside the states themselves, so a state added to the enum cannot reach the
	// screen without a name and a colour. Split is not a review state at all, so
	// its pill takes a series hue here rather than a place in that map.
	import { REVIEW_HUES, REVIEW_LABELS } from '$lib/transactions/filter';

	let { data, form } = $props();

	type Row = (typeof data.rows)[number];
	let splitting = $state<Row | null>(null);

	// Receipts open in a dialog rather than sitting under every row: a file input
	// and its chips took a whole line per transaction, on a page that is nothing
	// but transactions. Held by id, not by the row object — `data` is replaced
	// when the attach action returns, and a captured row would keep showing the
	// attachments the page had before the upload.
	let attachingId = $state<string | null>(null);
	// Which receipt's delete is armed. Cleared whenever the dialog changes rows,
	// so an armed button never carries over to a different transaction.
	let removing = $state<string | null>(null);
	const attaching = $derived(
		attachingId ? (data.rows.find((r) => r.id === attachingId) ?? null) : null
	);
	$effect(() => {
		void attachingId;
		void data.rows;
		removing = null;
	});

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
		<!-- A GET form submits its own fields and nothing else, so a chosen page
		     size would be dropped the moment anything was filtered. Only carried
		     when it differs from the default, to keep the URL clean. -->
		{#if data.pageSize !== data.defaultPageSize}
			<input type="hidden" name="per" value={data.pageSize} />
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
		<div class="matching-right">
			<span class="eyebrow-caption filter-total">
				{data.total}
				{data.total === 1 ? 'transaction' : 'transactions'}
				{#if data.totals.length > 0}
					· {data.totals.map((t) => `${t.amount} ${t.currency}`).join(' · ')}
				{/if}
			</span>
			<!-- Links, not a control that posts: every other part of this view lives
			     in the URL, so page size does too and a narrowed view stays
			     shareable at the size it was read in. -->
			<span class="per-page" role="group" aria-label="Rows per page">
				{#each data.pageSizes as p (p.size)}
					<a
						class="per"
						class:active={p.active}
						href={p.href}
						aria-current={p.active ? 'true' : undefined}
					>
						{p.size}
					</a>
				{/each}
			</span>
		</div>
	</div>

	{#if data.rows.length === 0}
		<p class="empty">Nothing matches. Widen the dates, or clear the filters.</p>
	{/if}

	{#each data.rows as r (r.id)}
		<div class="card txn-row">
			<div class="r-facts">
				<!-- Date and amount stack in one column: the amount under the merchant
				     line read as part of the detail, and this is the row's other fact
				     about itself rather than a description of it. -->
				<div class="r-when">
					<span class="mono r-date">{r.date}</span>
					<span class="mono r-amount" style:color={r.negative ? 'var(--red)' : 'var(--green)'}>
						{r.amount}
					</span>
				</div>
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
			</div>
			<div class="r-actions">
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
						<!-- The register is a long page and these rows run to the bottom of
						     it, which is where a native select's popup opened downwards past
						     the fold. An unfiled row must not look filed, so the value starts
						     empty until someone actually picks something. -->
						<CategoryPicker
							name="categoryId"
							groups={data.categories}
							value={r.categoryId}
							onpick={(id) => (chosen[r.id] = id)}
						/>
						<!-- Disabled until something is chosen: the placeholder posts an empty
						     category, which the action rejects with a message that used to have
						     nowhere to appear. The row read as an unresponsive button. -->
						<button type="submit" class="btn" disabled={!picked(r)}>Save</button>
					</form>
					<button type="button" class="btn" onclick={() => (splitting = r)}>Split</button>
				{/if}
				<!-- Receipts live behind this. The count is on the face of the button so
				     a row that has evidence filed against it says so without opening
				     anything.

				     The state sits under it, at the end of the row: it is what the row
				     IS rather than something to do to it, and reading it first — which
				     is what its old place ahead of the controls meant — put the
				     quietest fact in the loudest position. -->
				<div class="r-file">
					<button
						type="button"
						class="btn receipts"
						class:has-docs={r.documents.length > 0}
						aria-label="Receipts for {r.merchant}"
						onclick={() => (attachingId = r.id)}
					>
						📎{#if r.documents.length > 0}<span class="doc-count">{r.documents.length}</span>{/if}
					</button>
					<span class="r-state">
						<Pill hue={r.isSplit ? 'purple' : REVIEW_HUES[r.reviewState]}>
							{r.isSplit ? 'split' : REVIEW_LABELS[r.reviewState]}
						</Pill>
					</span>
				</div>
			</div>

			{#if form?.message && form?.id === r.id}
				<p class="row-error" role="alert">{form.message}</p>
			{/if}

			{#if r.isSplit}
				<ul class="splits">
					{#each r.splits as s (s.id)}
						<li class="split-line">
							<span class="s-category">{s.categoryLabel ?? 'Uncategorised'}</span>
							{#if s.tags.length > 0}
								<span class="s-note">{s.tags.map((tag) => `#${tag.name}`).join(' · ')}</span>
							{/if}
							{#if s.note}<span class="s-note">{s.note}</span>{/if}
							<span class="mono s-amount" style:color={s.negative ? 'var(--red)' : 'var(--green)'}>
								{s.amount}
							</span>
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

	{#if attaching}
		<Modal title="Receipts" onclose={() => (attachingId = null)}>
			<p class="modal-sub">{attaching.merchant} · {attaching.amount}</p>

			{#if form?.message && form?.id === attaching.id}
				<p class="row-error" role="alert">{form.message}</p>
			{/if}

			<div class="r-docs">
				{#each attaching.documents as doc (doc.id)}
					<span class="doc-chip">
						{#if doc.storedName}
							<a href="/files/{doc.storedName}" target="_blank" rel="noopener">{doc.name}</a>
						{:else}
							<span>{doc.name}</span>
						{/if}
						<!-- Deletes the document, not just this link: unlinking left the
						     file on the Documents shelf, unreachable from the row it came
						     from. Two taps rather than a browser confirm(), which would
						     block the dialog it is asked from. -->
						{#if removing === doc.id}
							<form method="POST" action="?/detachDocument" use:enhance>
								<input type="hidden" name="id" value={attaching.id} />
								<input type="hidden" name="documentId" value={doc.id} />
								<button type="submit" class="chip-del confirm">Delete?</button>
							</form>
						{:else}
							<button
								type="button"
								class="chip-del"
								aria-label="Remove {doc.name}"
								onclick={() => (removing = doc.id)}
							>
								✕
							</button>
						{/if}
					</span>
				{:else}
					<span class="modal-sub">Nothing filed against this row yet.</span>
				{/each}
			</div>

			<form
				method="POST"
				action="?/attachDocument"
				enctype="multipart/form-data"
				use:enhance
				class="attach-form"
			>
				<input type="hidden" name="id" value={attaching.id} />
				<div class="attach-zone">
					<UploadDropzone
						name="file"
						accept="application/pdf,image/*"
						idleText="Drop a receipt here, or click to browse"
						description="PDF, PNG or JPEG"
					/>
				</div>
				<button type="submit" class="btn btn-primary">Attach</button>
			</form>
		</Modal>
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
	.matching-right {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		flex-wrap: wrap;
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
		/* What the state pill occupies: a --text-xs line at 1.2, plus its 2px
		   padding and 1px border top and bottom. The row reserves it because the
		   pill itself is positioned out of flow. */
		--state-h: 20px;
	}
	/* The card is a wrapping flex row, so a full basis is what puts the message
	   on its own line under the controls that produced it. */
	.r-docs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}
	/* The paperclip is an icon button, so it does not need the .btn text padding. */
	.receipts {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
	}
	.receipts.has-docs {
		color: var(--fg1);
		border-color: var(--bd2);
	}
	.doc-count {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.modal-sub {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
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
	.doc-chip .chip-del:hover,
	.doc-chip .chip-del.confirm {
		color: var(--red);
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
	.attach-zone {
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
		/* Wider than the date alone needs: the amount shares this column, and a
		   fixed width is what keeps both lined up from row to row — sizing to
		   content would let every card pick its own gutter. */
		display: grid;
		grid-template-columns: 100px minmax(0, 1fr);
		gap: var(--space-6);
		align-items: baseline;
		flex: 1 1 380px;
		min-width: 0;
	}
	.r-when {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
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
		font-size: var(--text-sm);
		font-weight: 600;
		/* Wraps rather than nowrap: a figure too long for the column would
		   otherwise run out of its cell and take the page into sideways scroll. */
		overflow-wrap: anywhere;
	}
	/* Category, Save, Split and the paperclip are one strip of controls, so they
	   sit at one gap rather than at the gap between separate things.

	   Room at the foot for the state, which hangs below the paperclip out of
	   flow: reserved here so nothing under the row can be sat on, and reserved
	   on the row rather than in the column so it cannot move a control. */
	.r-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		padding-bottom: calc(var(--state-h) + var(--space-3));
	}
	.r-file {
		position: relative;
		display: flex;
	}
	/* Out of flow on purpose. In flow it made this column taller than the
	   buttons beside it, and every one of them moved off the paperclip's line to
	   stay centred against it. */
	.r-state {
		position: absolute;
		top: calc(100% + var(--space-3));
		right: 0;
		line-height: 0;
	}
	.cat-form {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
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
			grid-template-columns: minmax(0, 1fr);
		}
		/* One column, so date and amount go side by side on a line of their own
		   rather than stacking into two — vertical space is the scarce one here. */
		.r-when {
			flex-direction: row;
			align-items: baseline;
			gap: var(--space-4);
		}
		.f-wide {
			grid-column: auto;
		}
	}
</style>
