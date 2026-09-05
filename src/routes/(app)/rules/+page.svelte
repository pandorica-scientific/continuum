<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { messageFromActionResult, shouldCloseAfterAction } from '$lib/actions/result';
	import ActionError from '$lib/components/ActionError.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import ControlRow from '$lib/components/ControlRow.svelte';
	import IconTile from '$lib/components/IconTile.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import type { Column, Group } from '$lib/components/data-table';
	import Icon from '$lib/components/Icon.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { groupNote, groupRules, trustTone, type RuleFilter } from '$lib/rules/grouping';

	let { data, form } = $props();

	// Grouped rather than paged. A household grows dozens of rules, and the pager
	// answered "show me twenty of them" when the question is "which of them is
	// wrong" — which a collapsed group header answers without opening anything.
	// Collapsing is what replaces the page size: seven closed groups are shorter
	// than twenty rows.
	let query = $state('');
	let filter = $state<RuleFilter>('all');
	let open = new SvelteSet<string>();

	const FILTERS: { value: RuleFilter; label: string; hue: string }[] = [
		{ value: 'all', label: 'All', hue: '--fg3' },
		{ value: 'below', label: 'Below the floor', hue: '--yellow' },
		{ value: 'disabled', label: 'Disabled', hue: '--fg3' }
	];

	const groups = $derived(groupRules(data.rules, filter, query));
	type RuleLine = (typeof groups)[number]['rules'][number];
	const groupByKey = $derived(new Map(groups.map((g) => [g.key, g])));
	const tableGroups = $derived<Group<RuleLine>[]>(
		groups.map((g) => ({ key: g.key, open: open.has(g.key), rows: g.rules }))
	);
	// The handoff's grid: name, trust, kept · overridden, then the actions. A
	// phone keeps the name and the trust bar; the counts are a detail behind a
	// wider screen.
	const COLUMNS: Column[] = [
		{ key: 'name', label: 'Category · rule', width: 'minmax(0, 1.6fr)' },
		{ key: 'trust', label: 'Trust (avg)', width: '170px' },
		{ key: 'kept', label: 'Kept · overridden', width: '160px', hideBelow: 900 },
		{ key: 'actions', label: '', width: '130px', hideBelow: 900 }
	];

	function toggle(key: string) {
		if (open.has(key)) open.delete(key);
		else open.add(key);
	}

	// Local, so the slider moves under the thumb rather than after a round trip;
	// the server owns the record, and a writable derived re-seeds from it on the
	// next load rather than stranding the thumb where this tab left it.
	let floor = $derived(data.thresholdPct);

	function saveFloor() {
		const body = new FormData();
		body.set('pct', String(floor));
		void fetch('?/threshold', { method: 'POST', body }).then(() => invalidateAll());
	}

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

	function openEditor(prefill?: { counterparty: string | null; categoryId: string | null }) {
		const counterparty = prefill?.counterparty ?? '';
		draftName = counterparty;
		draftCategory = prefill?.categoryId ?? '';
		draftTags = '';
		conditions = [{ field: 'counterparty', value: counterparty, min: '', max: '' }];
		actionError = null;
		editing = true;
	}

	// Arriving from a transaction's "Make a rule". Read once, at init, which is
	// what untrack says: the draft belongs to the screen from here on, and a
	// re-read on the next load would throw away whatever had been typed since.
	const prefill = untrack(() => data.prefill);
	if (prefill) openEditor(prefill);

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
>
	{#snippet actions()}
		<button type="button" class="btn btn-primary" onclick={() => openEditor()}>New rule</button>
	{/snippet}
</ScreenHeader>

<p class="count-line">
	{data.rules.length}
	{data.rules.length === 1 ? 'rule' : 'rules'} · filing at
	<span class="mono floor-inline">{floor}%</span> confidence and above
</p>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<ControlRow>
	{#snippet left()}
		<label class="search">
			<Icon name="search" size={15} />
			<input
				type="search"
				bind:value={query}
				placeholder="Search rules"
				aria-label="Search rules"
			/>
		</label>
	{/snippet}
	{#snippet right()}
		<div class="chips-row" role="group" aria-label="Filter rules">
			{#each FILTERS as chip (chip.value)}
				<button
					type="button"
					class="chip"
					class:on={filter === chip.value}
					aria-pressed={filter === chip.value}
					style:--chip-hue="var({chip.hue})"
					onclick={() => (filter = chip.value)}
				>
					{chip.label}
				</button>
			{/each}
		</div>
	{/snippet}
</ControlRow>

<!-- The floor, which has been a stored setting with no way to change it since
     rules existed. It sits above the table because it is the number every row
     below is measured against. -->
<section class="card floor">
	<div class="floor-head">
		<IconTile hue="--yellow" icon="sliders" size={26} />
		<span class="floor-title">Confidence floor</span>
		<span class="quiet">A rule at or above this files on its own.</span>
	</div>
	<div class="floor-body">
		<span class="mono floor-end">0%</span>
		<!-- A native range, restyled. The track is drawn on the input itself so the
		     fill runs yellow to green up to the thumb: what a rule needs before it
		     files on its own is a scale, not a switch, and the gradient says which
		     end is "barely trusted". -->
		<input
			type="range"
			min="5"
			max="95"
			step="5"
			bind:value={floor}
			aria-label="Confidence floor"
			style:--fill="{floor}%"
			onchange={saveFloor}
		/>
		<span class="mono floor-end">100%</span>
		<span class="floor-value display">{floor}<span class="floor-pct">%</span></span>
	</div>
	<p class="scope-note">
		Changes apply to future imports and transactions still awaiting a category. Existing automatic
		filings stay as filed.
	</p>
</section>

{#if groups.length === 0}
	<p class="empty">
		{data.rules.length === 0
			? 'No rules yet. Filing a transaction teaches one, or write one by hand.'
			: 'No rule matches that.'}
	</p>
{:else}
	<DataTable
		columns={COLUMNS}
		groups={tableGroups}
		hue="--teal"
		label="Rules by category"
		rowKey={(r) => r.id}
		ontoggle={toggle}
	>
		{#snippet head(group, visible)}
			{@const g = groupByKey.get(group.key)!}
			{@const note = groupNote(g)}
			<!-- Collapsed by default. The header answers the question people come
			     to this screen with — "is anything filing wrongly?" — so opening a
			     group is for acting on an answer already given. -->
			<span class="g-name">
				<span class="chev" aria-hidden="true">{group.open ? '▾' : '▸'}</span>
				<span class="swatch" style:background="var({g.color})"></span>
				<span class="g-label">{g.label}</span>
				{#if note}<span class="g-note">{note}</span>{/if}
				<span class="mono g-count">{g.rules.length} {g.rules.length === 1 ? 'rule' : 'rules'}</span>
			</span>
			<span class="trust">
				<span class="bar"
					><span
						class="fill"
						style:width="{g.averagePct}%"
						style:background="var({trustTone(g.averagePct)})"
					></span></span
				>
				<span class="mono pct">{g.averagePct}%</span>
			</span>
			{#if visible.has('kept')}
				<span class="mono kept">{g.accepted} · {g.corrected}</span>
			{/if}
			{#if visible.has('actions')}<span></span>{/if}
		{/snippet}

		{#snippet row(r, visible)}
			<span class="r-name" class:off={!r.enabled}>
				<span class="r-title">
					{r.name}
					{#if !r.enabled}<Pill hue="grey">disabled</Pill>{/if}
				</span>
				<span class="r-when">{r.conditions.join(' · ')}</span>
				<span class="r-files">
					{#if r.category}files as <strong>{r.category}</strong>{/if}
					{#if r.tags.length > 0}· tags {r.tags.join(', ')}{/if}
					· {r.provenance}
				</span>
			</span>
			<span class="trust" class:off={!r.enabled}>
				<span class="bar"
					><span
						class="fill"
						style:width="{r.confidencePct}%"
						style:background="var({trustTone(r.confidencePct)})"
					></span></span
				>
				<span class="mono pct">{r.confidencePct}%</span>
			</span>
			{#if visible.has('kept')}
				<span class="mono kept" class:off={!r.enabled}>
					{#if r.startsTrusted && r.accepted === 0 && r.corrected === 0}
						starts trusted
					{:else}
						{r.accepted} · {r.corrected}
					{/if}
				</span>
			{/if}
			{#if visible.has('actions')}
				<span class="r-buttons">
					<form method="POST" action="?/toggle" use:enhance>
						<input type="hidden" name="id" value={r.id} />
						<button type="submit" class="btn small">{r.enabled ? 'Disable' : 'Enable'}</button>
					</form>
					<form method="POST" action="?/remove" use:enhance>
						<input type="hidden" name="id" value={r.id} />
						<button type="submit" class="btn small danger">Delete</button>
					</form>
				</span>
			{/if}
		{/snippet}
	</DataTable>
{/if}

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
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.g-name {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
	}
	.chev {
		color: var(--fg3);
		width: 10px;
		flex: none;
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: var(--radius-xs);
		flex: none;
	}
	.g-label {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.g-note {
		font-size: var(--text-sm);
		color: var(--fg3);
		white-space: nowrap;
	}
	.g-count {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	/* Kept and never applied. Dimmed rather than hidden: a disabled rule is the
	   explanation for something that stopped filing. */
	.off {
		opacity: 0.55;
	}
	.r-name {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		font-size: var(--text-md);
		/* Indented to the group's label, so the hierarchy is legible without a
		   second border down the left of the table. */
		padding-left: 42px;
	}
	.r-title {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		font-weight: 500;
	}
	.r-when,
	.r-files {
		font-size: 11.5px;
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.trust {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.bar {
		flex: 1;
		height: 5px;
		border-radius: var(--radius-pill);
		background: var(--card3);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: var(--radius-pill);
	}
	.pct {
		font-size: var(--text-xs);
		color: var(--fg2);
		width: 34px;
		text-align: right;
	}
	/* `12 · 0` with room around the dot: two counts read as one number when
	   the separator is crushed between them. */
	.kept {
		font-size: var(--text-xs);
		color: var(--fg3);
		white-space: nowrap;
		word-spacing: var(--space-2);
	}
	.r-buttons {
		display: flex;
		gap: var(--space-3);
		justify-content: flex-end;
	}
	.btn.small {
		min-height: 28px;
		padding: 3px var(--space-5);
		font-size: var(--text-sm);
	}
	.btn.danger {
		color: var(--red);
	}
	.btn.danger:hover {
		background: var(--red-tint);
	}

	.search {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex: 1 1 auto;
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
	.chip {
		height: 32px;
		padding: 0 var(--space-6);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		background: var(--card);
		color: var(--fg2);
		font-family: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
		white-space: nowrap;
		transition:
			background-color var(--dur) var(--ease),
			border-color var(--dur) var(--ease);
	}
	.chip.on {
		background: color-mix(in srgb, var(--chip-hue) 16%, transparent);
		border-color: color-mix(in srgb, var(--chip-hue) 45%, transparent);
		color: var(--fg1);
		font-weight: 600;
	}
	.chip:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}

	.floor {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.floor-head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.floor-title {
		font-size: var(--text-lg);
		font-weight: 600;
	}
	.floor-body {
		display: flex;
		align-items: center;
		gap: var(--space-7);
	}
	.floor-end {
		font-size: var(--text-sm);
		color: var(--fg3);
		flex: none;
	}
	.floor-body input[type='range'] {
		flex: 1;
		min-width: 0;
		height: 18px;
		margin: 0;
		padding: 0;
		background: none;
		appearance: none;
		cursor: pointer;
	}
	/* One track rule per engine: the fill has to be painted ON the track, and
	   the two browsers do not share a pseudo-element for it. */
	.floor-body input[type='range']::-webkit-slider-runnable-track {
		height: 8px;
		border-radius: var(--radius-xs);
		background:
			linear-gradient(90deg, var(--yellow), var(--green)) 0 / var(--fill) 100% no-repeat,
			var(--card3);
	}
	.floor-body input[type='range']::-moz-range-track {
		height: 8px;
		border-radius: var(--radius-xs);
		background:
			linear-gradient(90deg, var(--yellow), var(--green)) 0 / var(--fill) 100% no-repeat,
			var(--card3);
	}
	/* The ring is the page's own ground, so the thumb reads as sitting on the
	   track rather than being part of it. */
	.floor-body input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 18px;
		height: 18px;
		margin-top: -5px;
		border-radius: var(--radius-pill);
		background: var(--fg1);
		border: 3px solid var(--bg);
		box-shadow: var(--shadow-raise);
	}
	.floor-body input[type='range']::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border: 3px solid var(--bg);
		border-radius: var(--radius-pill);
		background: var(--fg1);
		box-shadow: var(--shadow-raise);
	}
	.floor-body input[type='range']:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 4px;
	}
	.floor-value {
		font-size: var(--text-3xl);
		min-width: 56px;
		text-align: right;
		flex: none;
	}
	.count-line {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.floor-inline {
		color: var(--fg1);
	}
	.floor-pct {
		font-size: var(--text-lg);
		color: var(--fg3);
		margin-left: 2px;
	}
	.scope-note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.empty {
		font-size: var(--text-md);
		color: var(--fg3);
	}

	@media (max-width: 899px) {
		.r-name {
			padding-left: var(--space-8);
		}
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
