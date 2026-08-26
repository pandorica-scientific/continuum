<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// Adding a payslip, in the same dialog the Tax screen files a statement in.
	//
	// It was an inline card that pushed the whole table down when open, and a
	// refusal had to be plumbed back through the page's `form` prop to reopen it
	// with what it refused. A modal holds its own draft, so a refusal simply
	// stays on screen with the figures still in the fields.
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
	/**
	 * The currency the slip is PRINTED in.
	 *
	 * Starts empty and stays required. Until v0.5.1 it was silently the
	 * household's base currency, which filed Czech payslips as euro — so the one
	 * thing this field must never do is offer a default nobody looked at. The
	 * slip fills it in when the slip says which currency it is.
	 */
	let currency = $state('');
	/**
	 * Where the currency in the field came from, so the note can say which.
	 *
	 * "Read from the slip" and "the same as the last one you filed" are different
	 * claims: the first is printed on the paper, the second is a good guess about
	 * a job that has not changed. Saying the second in the words of the first
	 * would be the same quiet assumption this field exists to remove.
	 */
	let currencyFrom = $state<'slip' | 'learned' | null>(null);
	/**
	 * What the month already held when this slip was filed.
	 *
	 * A month can hold more than one payslip since v0.5.5 — two jobs are two
	 * slips — and an upload no longer replaces what is there. That is the right
	 * behaviour and an invisible one: filing August twice by mistake looks
	 * exactly like filing two jobs on purpose, so the dialog says which happened
	 * and stays open long enough to be read.
	 */
	let alsoFiled = $state<{ periodMonth: string; count: number } | null>(null);
	/**
	 * The slip was recognised as one already filed, so nothing was added.
	 *
	 * The opposite news from `alsoFiled` and just as invisible without saying
	 * it: an upload that corrected a statement rather than making one looks,
	 * from here, exactly like an upload that did nothing at all.
	 */
	let sameSlip = $state<{ periodMonth: string; moved: boolean } | null>(null);
	/**
	 * The dialog has done its work and is waiting to be dismissed.
	 *
	 * Held open so the news is read — but held open AS A FORM it was unreadable:
	 * the fields were still filled, the Add button was still there, and the only
	 * way to find out whether the slip had been filed was to press Add again and
	 * risk filing it twice. In this state there is nothing left to submit.
	 */
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
	// A browser will not let a file input be repopulated, so a refusal after one
	// was chosen has to say the file must be picked again rather than letting a
	// silent re-submit drop the upload.
	let fileWasChosen = $state(false);
	let showHint = $state(false);

	// Reading the chosen file so its figures can be checked before anything is
	// written. Filing blind and correcting afterwards is what this replaces —
	// and a correction teaches the reader a label, so a wrong one taught it the
	// wrong thing.
	let reading = $state(false);
	let readNote = $state<string | null>(null);

	/**
	 * Which fields the person actually edited.
	 *
	 * A prefilled figure is still the reader's answer, not a decision, and the
	 * server needs to know the difference: it decides whether the month counts as
	 * hand-corrected, and whether a label is learned from it.
	 */
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
			// Only fields nobody has touched: a figure already typed is a decision
			// and the reader does not get to overwrite it.
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
		<!-- Beside the title rather than down among the buttons: it explains what
		     the whole dialog is asking for, not what Add does. -->
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
			// Bubbles up from the dropzone's own input. This handler is not a
			// filename display: it starts reading the slip, which is what fills
			// the three figures in.
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
				// The figures the entry refused come back with the failure, READ ones
				// included: "net cannot be more than gross" is unanswerable without
				// seeing which two numbers it meant, and a slip read from a PDF put
				// nothing in these fields to begin with.
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
				// Held open when the month already had a slip, or when this file was
				// one already filed, so what just happened is read rather than
				// guessed at from a row appearing twice — or from no row appearing.
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
			<!-- The form is GONE, not merely annotated. Left standing it said
			     nothing about whether the slip had been filed: the fields were
			     still full and Add was still there, so the only way to find out
			     was to press Add a second time — on a screen where a second press
			     files a second payslip. What is left is the news and two ways out. -->
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
				<!-- Behind an ⓘ rather than always on: it explains the model once, and a
			     paragraph read on the first upload and skipped on every one after is
			     not worth the space it takes permanently. -->
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
				<!-- Named as the guess it is. The slip printed no currency; this is the
			     one stated last time for this person, and it is remembered so the
			     question is not asked again every month for the same job. -->
				<p class="reading">
					This slip does not name a currency. {currency} is what was stated last time — change it if this
					month is different.
				</p>
			{:else if fileWasChosen && !currency}
				<!-- Said out loud rather than filled in quietly. The base currency is
			     where this household REPORTS; it is not evidence of what anybody
			     was paid. -->
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
						<!-- No preselected currency. An empty option a browser refuses to
					     submit is the whole point: the household's base sitting here by
					     default is exactly how six koruna payslips became euro. -->
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
		gap: 10px 12px;
		/* Controls line up along their BOTTOM edge: a label that wraps to two
		   lines would otherwise push its input a line below the ones beside it,
		   and a row of controls that no longer lines up stops reading as a row. */
		align-items: end;
	}
	/* Without this the labels fall back to the page default and lay themselves
	   out inline, so "Whose" sat beside its select while "Month" sat above its
	   own — every field a different shape. The tax dialog states the same rule
	   for the same reason. */
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* Only what the base control layer cannot know: these live in 1fr grid
	   tracks and have to be allowed to be narrower than their content. */
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
