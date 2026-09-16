<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// A modal holds its own draft, so a refusal stays on screen with the
	// figures still in the fields.
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { messageFromActionResult, shouldCloseAfterAction } from '$lib/actions/result';
	import ActionError from '$lib/components/ActionError.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import { currencyLabel } from '$lib/currencies';

	let {
		people,
		currencies,
		baseCurrency,
		onclose
	}: {
		people: { id: string; name: string }[];
		/** Every currency this instance can convert. */
		currencies: string[];
		/** Only to say which one is the household's — never to preselect it. */
		baseCurrency: string;
		onclose: () => void;
	} = $props();

	let personId = $state(untrack(() => people[0]?.id ?? ''));
	let periodMonth = $state('');
	let gross = $state('');
	let net = $state('');
	let bonus = $state('');
	/** Currency the slip is printed in. Stays empty by default — never default
	 *  to the household base, which would silently mislabel foreign slips. */
	let currency = $state('');
	/** Where `currency` came from, so the note can say "read from the slip"
	 *  vs. "same as last time" rather than conflating the two. */
	let currencyFrom = $state<'slip' | 'learned' | null>(null);
	/** A month can hold more than one payslip (two jobs = two slips), so an
	 *  upload never replaces what's there; this says what already existed. */
	let alsoFiled = $state<{ periodMonth: string; count: number } | null>(null);
	/** Set when the upload matches a slip already filed, so nothing was added. */
	let sameSlip = $state<{ periodMonth: string; moved: boolean } | null>(null);
	/** Dialog has finished and is waiting to be dismissed; the form is hidden
	 *  so a second Add press can't re-file the same slip. */
	const settled = $derived(alsoFiled !== null || sameSlip !== null);

	/** Back to an empty draft, for the next slip, without leaving and returning. */
	function addAnother() {
		alsoFiled = null;
		sameSlip = null;
		periodMonth = '';
		gross = '';
		net = '';
		bonus = '';
		currency = '';
		currencyFrom = null;
		readNote = null;
		actionError = null;
		touched = [];
		fileName = null;
		fileWasChosen = false;
	}
	let fileName = $state<string | null>(null);
	let actionError = $state<string | null>(null);
	// A browser won't repopulate a file input, so a refusal must ask for it again.
	let fileWasChosen = $state(false);
	let showHint = $state(false);

	let reading = $state(false);
	let readNote = $state<string | null>(null);

	/** Which fields were hand-edited vs. prefilled; the server uses this to
	 *  decide whether a month counts as hand-corrected and whether to learn a label. */
	let touched = $state<string[]>([]);
	const touch = (field: string) => {
		if (!touched.includes(field)) touched = [...touched, field];
	};

	async function readChosen(file: File) {
		reading = true;
		readNote = null;
		try {
			const body = new FormData();
			body.set('file', file);
			body.set('personId', personId);
			const response = await fetch('/salary/read', { method: 'POST', body });
			if (!response.ok) {
				readNote = 'Could not read this file — fill the figures in by hand.';
				return;
			}
			const read = (await response.json()) as Record<string, string | null>;
			// Only fill fields the reader hasn't touched — never overwrite a typed value.
			if (!touched.includes('gross')) gross = read.gross ?? '';
			if (!touched.includes('net')) net = read.net ?? '';
			if (!touched.includes('bonus')) bonus = read.bonus ?? '';
			if (!touched.includes('periodMonth') && read.periodMonth) periodMonth = read.periodMonth;
			if (!touched.includes('currency') && read.currency) {
				currency = read.currency;
				currencyFrom = (read.currencyFrom as 'slip' | 'learned' | null) ?? null;
			}
			readNote =
				read.gross || read.net
					? 'Read from the slip — check the figures before adding.'
					: 'No pay figure found on this slip — fill one in by hand.';
		} catch {
			readNote = 'Could not read this file — fill the figures in by hand.';
		} finally {
			reading = false;
		}
	}
</script>

<Modal title="Add payslip" {onclose}>
	{#snippet titleAside()}
		<button
			type="button"
			class="icon-btn"
			aria-expanded={showHint}
			aria-label="How these figures are read"
			onclick={() => (showHint = !showHint)}
		>
			<Icon name="info" size={15} />
		</button>
	{/snippet}

	<form
		method="POST"
		action="?/addPayslip"
		enctype="multipart/form-data"
		onchange={(event) => {
			// Bubbles up from the dropzone's input; starts reading the slip.
			const target = event.target as HTMLInputElement;
			if (target?.type !== 'file') return;
			const picked = target.files?.[0] ?? null;
			fileName = picked?.name ?? null;
			fileWasChosen = picked !== null;
			if (picked) void readChosen(picked);
		}}
		use:enhance={() =>
			async ({ result, update }) => {
				actionError = messageFromActionResult(result);
				alsoFiled =
					result.type === 'success' ? ((result.data?.alsoFiled as typeof alsoFiled) ?? null) : null;
				sameSlip =
					result.type === 'success' ? ((result.data?.sameSlip as typeof sameSlip) ?? null) : null;
				// Refused figures (including ones read from the slip) come back with
				// the failure so the error can reference them.
				if (result.type === 'failure') {
					const values = result.data?.values as Record<string, string> | undefined;
					if (values) {
						personId = values.personId || personId;
						periodMonth = values.periodMonth ?? periodMonth;
						gross = values.gross ?? gross;
						net = values.net ?? net;
						bonus = values.bonus ?? bonus;
						currency = values.currency || currency;
					}
					fileName = null;
				}
				// Never reset: the draft is the whole reason this is a dialog.
				await update({ reset: false });
				if (shouldCloseAfterAction(result.type) && !settled) onclose();
				if (settled) {
					fileName = null;
					fileWasChosen = false;
				}
			}}
		class="payslip-form"
	>
		<ActionError message={actionError} />
		<input type="hidden" name="touched" value={touched.join(',')} />

		{#if settled}
			{#if sameSlip}
				<p class="also">
					Nothing was added. This is the payslip already filed for {sameSlip.periodMonth}{#if sameSlip.moved},
						which has been moved to that month{/if} — the same file, so its statement was corrected rather
					than a second one made.
				</p>
			{:else if alsoFiled}
				<p class="also">
					Filed. {alsoFiled.periodMonth} now has {alsoFiled.count + 1} payslips — that is what two jobs
					in a month look like. If this one was a mistake, remove it from its ⋯ menu on the table.
				</p>
			{/if}
			<div class="row">
				<button type="button" class="btn btn-primary" onclick={onclose}>Done</button>
				<button type="button" class="btn" onclick={addAnother}>Add another</button>
			</div>
		{:else}
			{#if showHint}
				<p class="hint">
					A payslip states gross and net; the bonus is part of gross, so gross 100 000 with a 25 000
					bonus means a base of 75 000. The slip is read for all three and for its month. Anything
					filled in here wins, and a correction teaches the reader for next month.
				</p>
			{/if}

			{#if reading}
				<p class="reading">Reading the slip…</p>
			{:else if readNote}
				<p class="reading">{readNote}</p>
			{/if}

			{#if currencyFrom === 'slip'}
				<p class="reading">
					Currency read from the slip as {currency} — change it if that is wrong.
				</p>
			{:else if currencyFrom === 'learned'}
				<p class="reading">
					This slip does not name a currency. {currency} is what was stated last time — change it if this
					month is different.
				</p>
			{:else if fileWasChosen && !currency}
				<p class="refile">
					The slip does not name a currency. Pick the one it was paid in — this household reports in
					{baseCurrency}, which is not the same question.
				</p>
			{/if}

			{#if actionError && fileWasChosen}
				<p class="refile">Choose the file again — a browser will not let one be put back.</p>
			{/if}

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
					<span>Month</span>
					<input
						type="month"
						name="periodMonth"
						bind:value={periodMonth}
						oninput={() => touch('periodMonth')}
					/>
				</label>
				<label>
					<span>Currency</span>
					<select
						name="currency"
						required
						bind:value={currency}
						onchange={() => {
							touch('currency');
							currencyFrom = null;
						}}
					>
						<!-- Empty option a browser refuses to submit — no preselected currency. -->
						<option value="" disabled>Which currency?</option>
						{#each currencies as code (code)}
							<option value={code}>{currencyLabel(code)}</option>
						{/each}
					</select>
				</label>
				<label class="wide">
					<span>Payslip PDF</span>
					<UploadDropzone
						name="file"
						accept=".pdf,image/*"
						idleText="Drop the payslip here, or click to browse"
						description="A PDF, or a photo of the slip — figures are only read from a PDF"
					/>
				</label>
				<label>
					<span>Gross</span>
					<input
						name="gross"
						inputmode="decimal"
						placeholder="read from the slip"
						bind:value={gross}
					/>
				</label>
				<label>
					<span>Net</span>
					<input
						name="net"
						inputmode="decimal"
						placeholder="read from the slip"
						bind:value={net}
						oninput={() => touch('net')}
					/>
				</label>
				<label>
					<span>Bonus</span>
					<input
						name="bonus"
						inputmode="decimal"
						placeholder="part of gross"
						bind:value={bonus}
						oninput={() => touch('bonus')}
					/>
				</label>
			</div>

			<div class="row">
				<button type="submit" class="btn btn-primary">Add</button>
				<button type="button" class="btn" onclick={onclose}>Cancel</button>
				{#if fileName}<span class="chosen mono">{fileName}</span>{/if}
			</div>
		{/if}
	</form>
</Modal>

<style>
	.payslip-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: var(--space-5) var(--space-6);
		/* Align controls on their bottom edge so a wrapped label doesn't drop
		   its input below the row. */
		align-items: end;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* Allow narrower than content — these live in 1fr grid tracks. */
	.payslip-form input,
	.payslip-form select {
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
	.chosen {
		font-size: var(--text-xs);
		color: var(--fg3);
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.reading {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.refile {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--yellow);
	}
	.also {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--yellow);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--fg3);
		margin: 0;
	}
</style>
