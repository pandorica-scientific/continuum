<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';

	interface CategoryGroup {
		key: string;
		label: string;
		items: { id: string; name: string }[];
	}

	interface SplitLine {
		amountMajor: string;
		categoryId: string | null;
	}

	let {
		transactionId,
		merchant,
		amountMajor,
		currency,
		categories,
		existing,
		onclose
	}: {
		transactionId: string;
		merchant: string;
		amountMajor: string;
		currency: string;
		categories: CategoryGroup[];
		existing: SplitLine[];
		onclose: () => void;
	} = $props();

	// Editing an existing split starts from its lines; a fresh split starts
	// from two empty ones, since one line is not a split.
	let lines = $state<SplitLine[]>(
		existing.length > 0
			? existing.map((l) => ({ ...l }))
			: [
					{ amountMajor: '', categoryId: null },
					{ amountMajor: '', categoryId: null }
				]
	);

	/**
	 * Decimal string to a number of minor units, tolerating "1 234,56" and the
	 * real minus sign (U+2212) that formatMinor renders negatives with \u2014 without
	 * that, the target for any money-out transaction would parse as zero and the
	 * dialog could never balance.
	 */
	function toMinor(raw: string): number | null {
		const cleaned = raw
			.replace(/[\s\u00a0\u202f]/gu, '')
			.replace(/\u2212/gu, '-')
			.replace(',', '.');
		if (!/^[+-]?\d+(\.\d*)?$/.test(cleaned)) return null;
		return Math.round(Number(cleaned) * 100);
	}

	const targetMinor = $derived(toMinor(amountMajor) ?? 0);
	const filled = $derived(lines.filter((l) => l.amountMajor.trim() !== ''));
	const anyInvalid = $derived(filled.some((l) => toMinor(l.amountMajor) === null));
	const sumMinor = $derived(filled.reduce((sum, l) => sum + (toMinor(l.amountMajor) ?? 0), 0));
	const remainderMinor = $derived(targetMinor - sumMinor);
	const balanced = $derived(remainderMinor === 0 && filled.length >= 2 && !anyInvalid);

	const remainder = $derived(
		(remainderMinor / 100).toLocaleString('en', { minimumFractionDigits: 2 }).replace(/,/g, ' ')
	);
</script>

<Modal title="Split {merchant}" {onclose}>
	<!-- update() has to run, or the register keeps rendering the pre-split row. -->
	<form
		method="POST"
		action="?/split"
		use:enhance={() =>
			async ({ update }) => {
				await update();
				onclose();
			}}
		class="split-form"
	>
		<input type="hidden" name="id" value={transactionId} />
		<input type="hidden" name="currency" value={currency} />

		<p class="target">
			Dividing <strong>{amountMajor} {currency}</strong>. The lines have to add up to it exactly.
		</p>

		{#each lines as line, i (i)}
			<div class="split-line">
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
				onclick={() => (lines = [...lines, { amountMajor: '', categoryId: null }])}
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
	</form>
</Modal>

<style>
	.split-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.target {
		font-size: 13px;
		color: var(--fg3);
		margin: 0;
	}
	.split-line {
		display: grid;
		grid-template-columns: 130px minmax(0, 1fr) auto;
		gap: 8px;
		align-items: center;
	}
	.split-form input,
	.split-form select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
		min-width: 0;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		border-top: 1px solid var(--bd);
		padding-top: 12px;
	}
	.remainder {
		font-size: 12px;
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
