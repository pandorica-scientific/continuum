<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	/**
	 * Filing a run of payslips at once — a year of them, or a job's worth.
	 *
	 * Its own dialog rather than a mode of the single-slip one, because the two
	 * ask different questions. That one shows what it read and waits for you to
	 * check it, which is the whole reason it exists; nobody checks twelve slips in
	 * a dialog. This one files only what it can read with confidence and names
	 * every file it could not, so the ones needing a human go through the other
	 * door one at a time.
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
	/**
	 * Files that were already on the shelf — the same bytes, already filed.
	 *
	 * Kept apart from `skipped`, which means "this one needs you". These need
	 * nothing; they are listed so that eleven of twelve landing is not read as
	 * a failure, and so that dropping a folder in twice is visibly harmless.
	 */
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
				// Never closed automatically: what was filed and what was refused is
				// the result, and closing over it would be the same as not reporting.
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
				<!-- Optional, unlike the single-slip dialog's. Most slips name their
				     own currency, and one stated earlier for this person is remembered;
				     this only covers the ones where neither is true. -->
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
		gap: 10px 12px;
		/* Controls line up along their BOTTOM edge: a label that wraps to two
		   lines would otherwise push its input a line below the ones beside it,
		   and a row of controls that no longer lines up stops reading as a row. */
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
	/* Not the refusal colour. Nothing here needs attention — a file already on
	   the shelf is a no-op reported, not a problem to go and fix. */
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
