<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { enhance } from '$app/forms';
	import { messageFromActionResult, shouldCloseAfterAction } from '$lib/actions/result';
	import ActionError from '$lib/components/ActionError.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ListPager from '$lib/components/ListPager.svelte';
	import PageSize, {
		DEFAULT_LIST_PAGE_SIZE,
		LIST_PAGE_SIZES
	} from '$lib/components/PageSize.svelte';
	import Modal from '$lib/components/Modal.svelte';

	let { data, form } = $props();

	// A household that has filed for a while grows dozens of these, and the list
	// was every one of them on one screen. Ordered most-overridden first, so the
	// rules worth looking at are on the first page.
	let size = $state<number>(DEFAULT_LIST_PAGE_SIZE);
	let page = $state(0);
	const pages = $derived(Math.max(1, Math.ceil(data.rules.length / size)));
	// A list that shrank — a delete, a rule disabled out of view — must not
	// strand the view on a page that no longer exists.
	$effect(() => {
		if (page > pages - 1) page = 0;
	});
	const shown = $derived(data.rules.slice(page * size, page * size + size));
	const range = $derived(
		data.rules.length === 0
			? ''
			: `${page * size + 1}–${Math.min(data.rules.length, page * size + size)} of ${data.rules.length}`
	);

	interface DraftCondition {
		field: string;
		value: string;
		min: string;
		max: string;
	}

	let editing = $state(false);
	let draftName = $state('');
	let draftCategory = $state('');
	let draftTags = $state('');
	let conditions = $state<DraftCondition[]>([]);
	let actionError = $state<string | null>(null);

	function openEditor() {
		draftName = '';
		draftCategory = '';
		draftTags = '';
		conditions = [{ field: 'counterparty', value: '', min: '', max: '' }];
		actionError = null;
		editing = true;
	}

	const canSave = $derived(
		draftName.trim() !== '' &&
			conditions.some((c) =>
				c.field === 'amount' ? c.min.trim() !== '' || c.max.trim() !== '' : c.value.trim() !== ''
			)
	);
</script>

<ScreenHeader
	title="Rules"
	caption="What files itself, and how much each rule has earned your trust."
/>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<section class="section">
	<div class="eyebrow-row">
		<Eyebrow emoji="⚙️" label="Rules" />
		<div class="rules-right">
			<span class="eyebrow-caption">
				{data.rules.length}
				{data.rules.length === 1 ? 'rule' : 'rules'} · filing at {data.thresholdPct}% confidence and
				above
			</span>
			{#if data.rules.length > LIST_PAGE_SIZES[0]}
				<!-- Above the rows it sizes, where the transactions screen puts its
				     own: how much to show is decided before reading. -->
				<PageSize bind:size onchange={() => (page = 0)} label="Rules" />
			{/if}
		</div>
	</div>
	<div class="toolbar">
		<button type="button" class="btn btn-primary" onclick={openEditor}>New rule</button>
	</div>
	<p class="scope-note">
		Changes apply to future imports and transactions still awaiting a category. Existing automatic
		filings stay as filed.
	</p>

	{#each shown as r (r.id)}
		<div class="card rule-row" class:off={!r.enabled}>
			<div class="r-main">
				<span class="r-name">{r.name}</span>
				<span class="r-conditions">{r.conditions.join(' · ')}</span>
				<span class="r-actions-taken">
					{#if r.category}files as <strong>{r.category}</strong>{/if}
					{#if r.tags.length > 0}· tags {r.tags.join(', ')}{/if}
					· {r.provenance}
				</span>
			</div>
			<div class="r-score">
				<span class="mono r-confidence" class:trusted={r.trusted}>{r.confidencePct}%</span>
				<span class="r-counts">
					{#if r.startsTrusted && r.accepted === 0 && r.corrected === 0}
						starts trusted · nothing decided yet
					{:else}
						{r.accepted} kept · {r.corrected} overridden
					{/if}
				</span>
			</div>
			<div class="r-buttons">
				<form method="POST" action="?/toggle" use:enhance>
					<input type="hidden" name="id" value={r.id} />
					<button type="submit" class="btn">{r.enabled ? 'Disable' : 'Enable'}</button>
				</form>
				<form method="POST" action="?/remove" use:enhance>
					<input type="hidden" name="id" value={r.id} />
					<button type="submit" class="btn">Delete</button>
				</form>
			</div>
		</div>
	{/each}

	{#if data.rules.length === 0}
		<p class="empty">No rules yet. Filing a transaction teaches one, or write one by hand.</p>
	{/if}

	<!-- Shown whenever the list is longer than the smallest page size, even when
	     the current size fits it all: the size switcher lives here, and hiding it
	     would leave no way back to a smaller page. -->
	{#if data.rules.length > LIST_PAGE_SIZES[0]}
		<div class="card pager-card">
			<ListPager bind:page {pages} {range} bare />
		</div>
	{/if}
</section>

{#if editing}
	<Modal title="New rule" onclose={() => (editing = false)}>
		<!-- reset: false, or previewing would clear the draft the preview is for.
		     The modal closes on save only, so a preview leaves the editor open. -->
		<form
			method="POST"
			action="?/save"
			use:enhance={({ action }) => {
				const saving = action.search.includes('save');
				return async ({ update, result }) => {
					actionError = messageFromActionResult(result);
					await update({ reset: false });
					if (saving && shouldCloseAfterAction(result.type)) editing = false;
				};
			}}
			class="rule-form"
		>
			<ActionError message={actionError} />
			<label>
				<span>Name</span>
				<input
					class="rule-name"
					name="name"
					bind:value={draftName}
					placeholder="Big Alza purchases"
				/>
			</label>

			{#each conditions as condition, i (i)}
				<div class="condition">
					<select name="conditionField" bind:value={condition.field}>
						<option value="counterparty">Counterparty contains</option>
						<option value="description">Note contains</option>
						<option value="counterAccount">Counter-account is</option>
						<option value="variableSymbol">Variable symbol is</option>
						<option value="amount">Amount between</option>
					</select>
					{#if condition.field === 'amount'}
						<input
							name="conditionMin"
							bind:value={condition.min}
							placeholder="min"
							inputmode="decimal"
						/>
						<input
							name="conditionMax"
							bind:value={condition.max}
							placeholder="max"
							inputmode="decimal"
						/>
						<input type="hidden" name="conditionValue" value="" />
					{:else}
						<input
							class="condition-value"
							name="conditionValue"
							bind:value={condition.value}
							placeholder="alza"
						/>
						<input type="hidden" name="conditionMin" value="" />
						<input type="hidden" name="conditionMax" value="" />
					{/if}
					{#if conditions.length > 1}
						<button
							type="button"
							class="btn"
							onclick={() => (conditions = conditions.filter((_, j) => j !== i))}
							aria-label="Remove condition {i + 1}">✕</button
						>
					{/if}
				</div>
			{/each}

			<button
				type="button"
				class="btn add-condition"
				onclick={() =>
					(conditions = [...conditions, { field: 'counterparty', value: '', min: '', max: '' }])}
			>
				＋ Add condition
			</button>

			<label>
				<span>Files as</span>
				<select class="rule-category" name="categoryId" bind:value={draftCategory}>
					<option value="">No category, tags only</option>
					{#each data.categories as group (group.key)}
						<optgroup label={group.label}>
							{#each group.items as c (c.id)}
								<option value={c.id}>{c.name}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
			</label>

			<label>
				<span>Tags (comma separated)</span>
				<input name="tagNames" bind:value={draftTags} placeholder="Renovation 2026" />
			</label>

			<div class="foot">
				<button type="submit" formaction="?/preview" class="btn">Preview matches</button>
				{#if form?.preview}
					<span class="preview-count">
						matches {form.preview.count}
						{form.preview.count === 1 ? 'transaction' : 'transactions'}
					</span>
				{/if}
				<button type="submit" class="btn btn-primary" disabled={!canSave}>Save rule</button>
			</div>

			{#if form?.preview && form.preview.rows.length > 0}
				<ul class="preview">
					{#each form.preview.rows as row (row.id)}
						<li>
							<span class="mono">{row.date}</span>
							{row.merchant} <span class="mono">{row.amount}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</form>
	</Modal>
{/if}

<style>
	/* The pager brings its own padding; the card is only here to give it the
	   same ground and edge the rule rows above it have. */
	.pager-card {
		padding: 0;
	}
	.rules-right {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
	}
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.toolbar {
		display: flex;
		gap: var(--space-5);
	}
	.scope-note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.rule-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
	}
	.rule-row.off {
		opacity: 0.55;
	}
	.r-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		flex: 1 1 320px;
		min-width: 0;
	}
	.r-name {
		font-size: var(--text-md);
		font-weight: 500;
	}
	.r-conditions,
	.r-actions-taken {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.r-score {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-1);
	}
	.r-confidence {
		font-size: var(--text-lg);
		color: var(--fg2);
	}
	.r-confidence.trusted {
		color: var(--green);
	}
	.r-counts {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.r-buttons {
		display: flex;
		gap: var(--space-4);
	}
	.rule-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.rule-form label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.rule-form input,
	.rule-form select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: var(--radius-md);
		padding: 8px 11px;
		font-size: var(--text-md);
		min-width: 0;
	}
	.condition {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto;
		gap: var(--space-4);
		align-items: center;
	}
	.add-condition {
		align-self: flex-start;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
		border-top: 1px solid var(--bd);
		padding-top: 12px;
	}
	.preview-count {
		font-size: var(--text-sm);
		color: var(--fg2);
		margin-left: auto;
	}
	.preview {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.empty {
		color: var(--fg3);
		font-size: var(--text-md);
	}
	button[disabled] {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
