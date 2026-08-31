<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { formatMinor, parseAmountToMinor } from '$lib/money';
	import { messageFromActionResult, shouldCloseAfterAction } from '$lib/actions/result';
	import { enhance } from '$app/forms';
	import ActionError from '$lib/components/ActionError.svelte';
	import Modal from '$lib/components/Modal.svelte';

	interface CategoryGroup {
		key: string;
		label: string;
		items: { id: string; name: string }[];
	}

	interface SplitLine {
		/** the transaction_split row this line came from, when editing one */
		id?: string | null;
		amountMajor: string;
		categoryId: string | null;
		tagNames: string;
	}

	let {
		transactionId,
		merchant,
		amountMajor,
		currency,
		categories,
		existing,
		knownTags,
		onclose
	}: {
		transactionId: string;
		merchant: string;
		amountMajor: string;
		currency: string;
		categories: CategoryGroup[];
		existing: SplitLine[];
		knownTags: { id: string; name: string }[];
		onclose: () => void;
	} = $props();

	// Editing an existing split starts from its lines; a fresh split starts
	// from two empty ones, since one line is not a split. The parent keys this
	// component by transaction id, so this intentionally is a one-time draft.
	// svelte-ignore state_referenced_locally
	let lines = $state<SplitLine[]>(
		existing.length > 0
			? existing.map((l) => ({ ...l }))
			: [
					{ amountMajor: '', categoryId: null, tagNames: '' },
					{ amountMajor: '', categoryId: null, tagNames: '' }
				]
	);
	let actionError = $state<string | null>(null);

	/**
	 * Decimal string to a number of minor units, tolerating "1 234,56" and the
	 * real minus sign (U+2212) that formatMinor renders negatives with \u2014 without
	 * that, the target for any money-out transaction would parse as zero and the
	 * dialog could never balance.
	 */
	function toMinor(raw: string): bigint | null {
		try {
			return parseAmountToMinor(raw, currency);
		} catch {
			return null;
		}
	}

	const targetMinor = $derived(toMinor(amountMajor) ?? 0n);
	const filled = $derived(lines.filter((l) => l.amountMajor.trim() !== ''));
	const anyInvalid = $derived(filled.some((l) => toMinor(l.amountMajor) === null));
	const sumMinor = $derived(filled.reduce((sum, l) => sum + (toMinor(l.amountMajor) ?? 0n), 0n));
	const remainderMinor = $derived(targetMinor - sumMinor);
	const balanced = $derived(remainderMinor === 0n && filled.length >= 2 && !anyInvalid);

	const remainder = $derived(formatMinor(remainderMinor, currency));
	const tagListId = $derived(`split-tags-${transactionId}`);
</script>

<Modal title="Split {merchant}" {onclose}>
	<!-- update() has to run, or the register keeps rendering the pre-split row. -->
	<form
		method="POST"
		action="?/split"
		use:enhance={() =>
			async ({ update, result }) => {
				actionError = messageFromActionResult(result);
				await update();
				if (shouldCloseAfterAction(result.type)) onclose();
			}}
		class="split-form"
	>
		<input type="hidden" name="id" value={transactionId} />
		<input type="hidden" name="currency" value={currency} />
		<ActionError message={actionError} />

		<p class="target">
			Dividing <strong>{amountMajor} {currency}</strong>. The lines have to add up to it exactly.
		</p>

		{#each lines as line, i (i)}
			<div class="split-line">
				<!-- Which stored row this line is, so tags stay with the line rather
				     than with its position in the list. -->
				<input type="hidden" name="lineId" value={line.id ?? ''} />
				<input
					name="amount"
					bind:value={line.amountMajor}
					inputmode="decimal"
					placeholder="0,00"
					aria-label="Line {i + 1} amount"
				/>
				<select name="categoryId" bind:value={line.categoryId} aria-label="Line {i + 1} category">
					<option value={null}>Uncategorised</option>
					{#each categories as group (group.key)}
						<optgroup label={group.label}>
							{#each group.items as c (c.id)}
								<option value={c.id}>{c.name}</option>
							{/each}
						</optgroup>
					{/each}
				</select>
				<input
					name="splitTags"
					bind:value={line.tagNames}
					list={tagListId}
					placeholder="tags, comma separated"
					aria-label="Line {i + 1} tags"
					autocomplete="off"
				/>
				{#if lines.length > 2}
					<button
						type="button"
						class="btn drop"
						onclick={() => (lines = lines.filter((_, j) => j !== i))}
						aria-label="Remove line {i + 1}"
					>
						✕
					</button>
				{/if}
			</div>
		{/each}

		<div class="foot">
			<button
				type="button"
				class="btn"
				onclick={() => (lines = [...lines, { amountMajor: '', categoryId: null, tagNames: '' }])}
			>
				＋ Add line
			</button>
			<span class="remainder" class:ok={balanced}>
				{#if anyInvalid}
					Some line is not a number
				{:else if balanced}
					Balanced
				{:else if filled.length < 2}
					Needs at least two lines
				{:else}
					{remainder}
					{currency} left to allocate
				{/if}
			</span>
			<button type="submit" class="btn btn-primary" disabled={!balanced}>Save split</button>
		</div>
		<datalist id={tagListId}>
			{#each knownTags as tag (tag.id)}
				<option value={tag.name}></option>
			{/each}
		</datalist>
	</form>
</Modal>

<style>
	.split-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.target {
		font-size: var(--text-md);
		color: var(--fg3);
		margin: 0;
	}
	.split-line {
		display: grid;
		grid-template-columns: 130px minmax(0, 1fr) minmax(150px, 0.8fr) auto;
		gap: var(--space-4);
		align-items: center;
	}
	.split-form input,
	.split-form select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: var(--radius-md);
		padding: 8px 11px;
		font-size: var(--text-md);
		min-width: 0;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
		border-top: 1px solid var(--bd);
		padding-top: 12px;
	}
	.remainder {
		font-size: var(--text-sm);
		color: var(--fg3);
		margin-left: auto;
	}
	.remainder.ok {
		color: var(--green);
	}
	.drop {
		padding: 7px 10px;
	}
	button[disabled] {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
