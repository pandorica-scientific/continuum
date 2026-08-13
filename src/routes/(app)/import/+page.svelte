<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import MetricTile from '$lib/components/MetricTile.svelte';

	let { data, form } = $props();

	let fileInput: HTMLInputElement | undefined = $state();
	let uploading = $state(false);
	let dragOver = $state(false);
	let assignAccountId = $state('');

	async function uploadFiles(files: FileList | File[]) {
		const body = new FormData();
		for (const f of files) body.append('statements', f);
		if (assignAccountId) body.set('accountId', assignAccountId);
		uploading = true;
		try {
			await fetch('?/upload', { method: 'POST', body });
			await invalidateAll();
		} finally {
			uploading = false;
		}
	}
</script>

<ScreenHeader
	emoji="📥"
	title="Import"
	caption="Statements in, transactions filed. Only the ambiguous ones ask for you."
/>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<section class="section">
	<div
		class="dropzone"
		class:drag={dragOver}
		role="button"
		tabindex="0"
		onclick={() => fileInput?.click()}
		onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
		ondragover={(e) => {
			e.preventDefault();
			dragOver = true;
		}}
		ondragleave={() => (dragOver = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragOver = false;
			if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
		}}
	>
		<span class="dz-emoji">📥</span>
		<span class="dz-title">
			{uploading ? 'Reading statements…' : 'Drop statements here, or click to browse'}
		</span>
		<span class="dz-note">
			CSV or PDF from any of the five banks, several files at once. The layout is detected,
			transfers between your own accounts are paired and dropped, and categories come from what you
			corrected last time.
		</span>
		<input
			bind:this={fileInput}
			type="file"
			multiple
			accept=".csv,.pdf,.xml,.ofx,.abo"
			style="display: none"
			onchange={() => fileInput?.files?.length && uploadFiles(fileInput.files)}
		/>
	</div>

	{#if data.accounts.length > 1}
		<label class="assign">
			<span>Assign to account</span>
			<select bind:value={assignAccountId} onclick={(e) => e.stopPropagation()}>
				<option value="">detect from the statement</option>
				{#each data.accounts as a (a.id)}
					<option value={a.id}>{a.name} · {a.currency}</option>
				{/each}
			</select>
			<span class="assign-note">
				needed when several accounts share a bank and currency — the statement cannot say which one
				it belongs to
			</span>
		</label>
	{/if}

	{#if form?.results}
		<div class="card results">
			{#each form.results as r (r.filename)}
				<div class="result-row">
					<span class="r-name">{r.filename}</span>
					<span class="r-meta mono">
						{#if r.error}{r.error}{:else}{r.rowsAdded} added · {r.rowsDuplicate} known · {r.rowsPaired}
							paired{/if}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</section>

<section class="tiles">
	<MetricTile label="Files this month" value={String(data.stats.filesThisMonth)} />
	<MetricTile label="Transactions read" value={String(data.stats.transactionsRead)} />
	<MetricTile
		label="Filed automatically"
		value={data.stats.autoPct === null ? '—' : `${data.stats.autoPct}%`}
		note="corrections teach the categoriser"
	/>
	<MetricTile
		label="Transfers paired"
		value={String(data.stats.transfersPaired)}
		note="excluded from income and spending"
	/>
</section>

<section class="section">
	<div class="eyebrow-row">
		<Eyebrow emoji="🧐" label="Needs a decision" />
		<span class="eyebrow-caption">
			{data.review.length === 0
				? 'nothing waiting — everything filed itself'
				: `${data.review.length} rows the categoriser will not guess at`}
		</span>
	</div>

	{#each data.review as r (r.id)}
		<div class="card review-row">
			<div class="r-facts">
				<span class="mono r-date">{r.date}</span>
				<div class="r-mid">
					<span class="r-merchant">{r.merchant}</span>
					<span class="r-reason">{r.reason} · {r.account}</span>
				</div>
				<span class="mono r-amount" style:color={r.negative ? 'var(--fg1)' : 'var(--green)'}>
					{r.amount}
				</span>
			</div>
			<div class="r-actions">
				{#if r.isTransfer}
					<form method="POST" action="?/confirmTransfer" use:enhance>
						<input type="hidden" name="id" value={r.id} />
						<button type="submit" class="btn">✓ Own transfer</button>
					</form>
					<form method="POST" action="?/rejectTransfer" use:enhance>
						<input type="hidden" name="id" value={r.id} />
						<button type="submit" class="btn">✕ Not a transfer</button>
					</form>
				{:else}
					<form method="POST" action="?/categorize" use:enhance class="cat-form">
						<input type="hidden" name="id" value={r.id} />
						<select name="categoryId">
							{#each data.categories as group (group.key)}
								<optgroup label={group.label}>
									{#each group.items as c (c.id)}
										<option value={c.id}>{c.name}</option>
									{/each}
								</optgroup>
							{/each}
						</select>
						<button type="submit" class="btn">File it</button>
					</form>
				{/if}
			</div>
		</div>
	{/each}
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
	.dropzone {
		border: 1.5px dashed var(--bd2);
		border-radius: 12px;
		padding: 34px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 7px;
		text-align: center;
		background: var(--card);
		cursor: pointer;
	}
	.dropzone.drag {
		background: var(--card2);
		border-color: var(--blue);
	}
	.dz-emoji {
		font-size: 24px;
	}
	.dz-title {
		font-size: 14.5px;
		font-weight: 500;
	}
	.dz-note {
		font-size: 12.5px;
		color: var(--fg3);
		max-width: 560px;
		line-height: 1.5;
	}
	.assign {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
		font-size: 12.5px;
		color: var(--fg3);
	}
	.assign select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 7px 11px;
		font-size: 13px;
	}
	.assign-note {
		font-size: 11.5px;
	}
	.results {
		display: flex;
		flex-direction: column;
	}
	.result-row {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		padding: 8px 0;
		border-top: 1px solid var(--bd);
		font-size: 13px;
	}
	.result-row:first-child {
		border-top: 0;
	}
	.r-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.r-meta {
		color: var(--fg3);
		font-size: 12px;
		white-space: nowrap;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
	}
	.review-row {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.r-facts {
		display: grid;
		grid-template-columns: 76px minmax(0, 1fr) auto;
		gap: 12px;
		align-items: baseline;
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
	}
	.r-reason {
		font-size: 12px;
		color: var(--fg3);
	}
	.r-amount {
		font-size: 14px;
	}
	.r-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		border-top: 1px solid var(--bd);
		padding-top: 10px;
	}
	.cat-form {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 7px 11px;
		font-size: 13px;
	}
	@media (max-width: 640px) {
		.r-facts {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.r-date {
			grid-column: 1 / -1;
		}
	}
</style>
