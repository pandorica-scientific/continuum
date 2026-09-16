<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Files a run of payslips at once. Separate from the single-slip dialog,
	 * which waits for a human to check each read — this one only files what it
	 * can read with confidence and lists the rest for the single-slip dialog.
	 */
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { messageFromActionResult } from '$lib/actions/result';
	import ActionError from '$lib/components/ActionError.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import { currencyLabel } from '$lib/currencies';

	let {
		people,
		currencies,
		onclose
	}: {
		people: { id: string; name: string }[];
		currencies: string[];
		onclose: () => void;
	} = $props();

	let personId = $state(untrack(() => people[0]?.id ?? ''));
	let currency = $state('');
	let chosen = $state<string[]>([]);
	let busy = $state(false);
	let actionError = $state<string | null>(null);
	let filed = $state<{ name: string; periodMonth: string }[]>([]);
	let skipped = $state<{ name: string; reason: string }[]>([]);
	/** Files already on the shelf (same bytes). Kept apart from `skipped`,
	 * which means "this one needs you" — these need nothing. */
	let already = $state<{ name: string; periodMonth: string | null }[]>([]);
	let done = $state(false);
</script>

<Modal title="Add several payslips" {onclose}>
	<form
		method="POST"
		action="?/addPayslips"
		enctype="multipart/form-data"
		use:enhance={() => {
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				actionError = messageFromActionResult(result);
				if (result.type === 'success') {
					const data = result.data as
						| { filed?: typeof filed; skipped?: typeof skipped; already?: typeof already }
						| undefined;
					filed = data?.filed ?? [];
					skipped = data?.skipped ?? [];
					already = data?.already ?? [];
					done = true;
					chosen = [];
				}
				// Never closed automatically — filed/refused results must stay visible.
				await update({ reset: false });
			};
		}}
		class="bulk-form"
	>
		<ActionError message={actionError} />

		<p class="hint">
			Each slip is read for its month, its figures and its currency, and filed on its own. Anything
			that cannot be read with confidence is listed back rather than guessed at — add those one at a
			time, where the figures can be checked before they are written.
		</p>

		<div class="grid">
			<label>
				<span>Whose</span>
				<select name="personId" bind:value={personId}>
					{#each people as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<!-- Optional, unlike the single-slip dialog's: only used when a slip
				     names no currency and none is remembered for this person. -->
				<span>Currency, if a slip does not say</span>
				<select name="currency" bind:value={currency}>
					<option value="">Refuse those slips</option>
					{#each currencies as code (code)}
						<option value={code}>{currencyLabel(code)}</option>
					{/each}
				</select>
			</label>
			<label class="wide">
				<span>Payslip PDFs</span>
				<input
					type="file"
					name="files"
					accept=".pdf"
					multiple
					onchange={(e) => {
						chosen = [...(e.currentTarget.files ?? [])].map((f) => f.name);
						done = false;
					}}
				/>
			</label>
		</div>

		{#if chosen.length > 0}
			<p class="chosen">{chosen.length} file{chosen.length === 1 ? '' : 's'} chosen.</p>
		{/if}

		{#if done}
			<div class="outcome">
				{#if filed.length > 0}
					<p class="filed">Filed {filed.length}: {filed.map((f) => f.periodMonth).join(', ')}</p>
				{/if}
				{#if already.length > 0}
					<p class="known">Already filed, so left alone:</p>
					<ul class="refused-list">
						{#each already as a (a.name)}
							<li>
								<span class="mono">{a.name}</span>
								{a.periodMonth ? `— already filed for ${a.periodMonth}` : '— already on the shelf'}
							</li>
						{/each}
					</ul>
				{/if}
				{#if skipped.length > 0}
					<p class="refused">Not filed:</p>
					<ul class="refused-list">
						{#each skipped as s (s.name)}
							<li><span class="mono">{s.name}</span> — {s.reason}</li>
						{/each}
					</ul>
				{/if}
				{#if filed.length === 0 && skipped.length === 0 && already.length === 0}
					<p class="filed">Nothing to file.</p>
				{/if}
			</div>
		{/if}

		<div class="row">
			<button type="submit" class="btn btn-primary" disabled={busy || chosen.length === 0}>
				{busy ? 'Reading…' : 'Add'}
			</button>
			<button type="button" class="btn" onclick={onclose}>{done ? 'Close' : 'Cancel'}</button>
		</div>
	</form>
</Modal>

<style>
	.bulk-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-5) var(--space-6);
		/* Align controls to their bottom edge so wrapped labels don't push
		   inputs out of line with the rest of the row. */
		align-items: end;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.bulk-form input,
	.bulk-form select {
		min-width: 0;
	}
	.wide {
		grid-column: 1 / -1;
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.hint,
	.chosen {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.outcome {
		border-top: 1px solid var(--bd2);
		padding-top: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.filed {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--green);
	}
	.refused {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--yellow);
	}
	/* Not the refusal colour — an already-filed file is a no-op, not a problem. */
	.known {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.refused-list {
		margin: 0;
		padding-left: 18px;
		font-size: var(--text-xs);
		color: var(--fg3);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
</style>
