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

	let {
		people,
		onclose
	}: {
		people: { id: string; name: string }[];
		onclose: () => void;
	} = $props();

	let personId = $state(untrack(() => people[0]?.id ?? ''));
	let periodMonth = $state('');
	let gross = $state('');
	let net = $state('');
	let bonus = $state('');
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
		use:enhance={() =>
			async ({ result, update }) => {
				actionError = messageFromActionResult(result);
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
					}
					fileName = null;
				}
				// Never reset: the draft is the whole reason this is a dialog.
				await update({ reset: false });
				if (shouldCloseAfterAction(result.type)) onclose();
			}}
		class="payslip-form"
	>
		<ActionError message={actionError} />
		<input type="hidden" name="touched" value={touched.join(',')} />

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
			<label class="wide">
				<span>Payslip PDF</span>
				<input
					type="file"
					name="file"
					accept=".pdf"
					onchange={(e) => {
						const picked = e.currentTarget.files?.[0] ?? null;
						fileName = picked?.name ?? null;
						fileWasChosen = picked !== null;
						if (picked) void readChosen(picked);
					}}
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
	.hint {
		font-size: var(--text-xs);
		color: var(--fg3);
		margin: 0;
	}
</style>
