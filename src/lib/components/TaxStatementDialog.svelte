<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { messageFromActionResult, shouldCloseAfterAction } from '$lib/actions/result';
	import ActionError from '$lib/components/ActionError.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import { currencyLabel } from '$lib/currencies';
	import { ATTACHMENT_KINDS } from '$lib/tax';

	interface Existing {
		id: string;
		personId: string;
		year: number;
		country: string;
		currencyCode: string;
		gross: string;
		taxPaid: string;
		lines: { label: string; amount: string }[];
		note: string | null;
	}

	let {
		people,
		taxDocs,
		currencies,
		prefillTotals,
		baseCurrency,
		existing,
		onclose
	}: {
		people: { id: string; name: string }[];
		taxDocs: { id: string; name: string }[];
		currencies: string[];
		prefillTotals: Record<string, { amount: string; months: number }>;
		baseCurrency: string;
		existing: Existing | null;
		onclose: () => void;
	} = $props();

	// Seeded once; re-reading `existing` while someone is typing would
	// overwrite what they had typed.
	const start = untrack(() => ({
		personId: existing?.personId ?? (people[0]?.id || ''),
		year: String(existing?.year ?? new Date().getFullYear() - 1),
		country: existing?.country ?? '',
		currency: existing?.currencyCode ?? baseCurrency,
		gross: existing?.gross ?? '',
		taxPaid: existing?.taxPaid ?? '',
		note: existing?.note ?? '',
		lines: existing?.lines.map((l) => ({ label: l.label, amount: l.amount })) ?? [
			{ label: '', amount: '' }
		]
	}));

	let personId = $state(start.personId);
	let year = $state(start.year);
	let country = $state(start.country);
	let currency = $state(start.currency);
	let gross = $state(start.gross);
	let taxPaid = $state(start.taxPaid);
	let note = $state(start.note);
	let lines = $state(start.lines);
	let actionError = $state<string | null>(null);
	let fileNames = $state<string[]>([]);
	let fileKind = $state<string>('statement');

	// A statement in a currency the rate source no longer quotes must still
	// show that currency selected, not silently switch to another one.
	const currencyOptions = $derived(
		currencies.includes(currency) ? currencies : [currency, ...currencies]
	);

	// Prefill only while creating; editing an existing statement never
	// re-derives a saved figure.
	let grossTouched = $state(untrack(() => existing !== null));
	const suggestion = $derived(prefillTotals[`${personId}|${Number(year)}`] ?? null);
	$effect(() => {
		if (!grossTouched) gross = suggestion?.amount ?? '';
	});
</script>

<Modal title={existing ? 'Edit statement' : 'Add statement'} {onclose}>
	<form
		method="POST"
		action="?/save"
		enctype="multipart/form-data"
		onchange={(event) => {
			// Bubbles up from the dropzone's own input; fileNames also gates the
			// kind select and document picker below.
			const target = event.target as HTMLInputElement;
			if (target?.type === 'file') fileNames = [...(target.files ?? [])].map((f) => f.name);
		}}
		use:enhance={() =>
			async ({ update, result }) => {
				actionError = messageFromActionResult(result);
				await update();
				if (shouldCloseAfterAction(result.type)) onclose();
			}}
		class="tax-form"
	>
		<ActionError message={actionError} />
		<div class="grid">
			<label>
				<span>Whose</span>
				<select class="tax-person" name="personId" bind:value={personId}>
					{#each people as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Year</span>
				<input class="tax-year" name="year" inputmode="numeric" bind:value={year} />
			</label>
			<label>
				<span>Country</span>
				<input class="tax-country" name="country" placeholder="CZ" bind:value={country} />
			</label>
			<label>
				<span>Currency</span>
				<select class="tax-currency" name="currency" bind:value={currency}>
					{#each currencyOptions as c (c)}
						<option value={c}>{currencyLabel(c)}</option>
					{/each}
				</select>
			</label>
			<label>
				<span
					>Gross income {suggestion && !grossTouched
						? `· from ${suggestion.months} payslips`
						: ''}</span
				>
				<input
					class="tax-gross"
					name="gross"
					inputmode="decimal"
					bind:value={gross}
					oninput={() => (grossTouched = true)}
				/>
			</label>
			<label>
				<span>Tax paid</span>
				<input class="tax-paid" name="taxPaid" inputmode="decimal" bind:value={taxPaid} />
			</label>
		</div>

		<span class="section-label">Itemised lines (optional)</span>
		{#each lines as line, i (i)}
			<div class="line">
				<input name="lineLabel" placeholder="Social insurance" bind:value={line.label} />
				<div class="line-amount">
					<input name="lineAmount" placeholder="0" inputmode="decimal" bind:value={line.amount} />
					{#if lines.length > 1}
						<button
							type="button"
							class="btn line-remove"
							onclick={() => (lines = lines.filter((_, j) => j !== i))}
							aria-label="Remove line {i + 1}">✕</button
						>
					{/if}
				</div>
			</div>
		{/each}
		<button
			type="button"
			class="btn add-line"
			onclick={() => (lines = [...lines, { label: '', amount: '' }])}
		>
			＋ Add line
		</button>

		<span class="section-label">The paperwork</span>
		<div class="grid">
			<label>
				<!-- Several files at once, since a year's filing is several papers;
				     one kind per batch, so a mixed batch is two saves. -->
				<span>Upload the paperwork</span>
				<UploadDropzone
					name="file"
					multiple
					accept=".pdf,.png,.jpg,.jpeg,.webp"
					idleText="Drop the paperwork here, or click to browse"
					description="PDF, PNG, JPEG or WebP"
				/>
			</label>
			<label>
				<span>What these are</span>
				<select name="fileKind" bind:value={fileKind} disabled={fileNames.length === 0}>
					{#each ATTACHMENT_KINDS as k (k.key)}
						<option value={k.key}>{k.label}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>…or one already on the Finance shelf</span>
				<select name="documentId" disabled={fileNames.length > 0}>
					<option value="">None attached</option>
					{#each taxDocs as d (d.id)}
						<option value={d.id}>{d.name}</option>
					{/each}
				</select>
			</label>
		</div>
		{#if fileNames.length > 0}
			<span class="attach-note">
				{fileNames.length}
				{fileNames.length === 1 ? 'file' : 'files'} will be filed on the Finance shelf as “{year}
				{country.trim().toUpperCase() || '—'}
				{ATTACHMENT_KINDS.find((k) => k.key === fileKind)?.noun}”.
			</span>
		{/if}

		<div class="grid">
			<label>
				<span>Note</span>
				<input name="note" bind:value={note} placeholder="joint filing, refund pending, …" />
			</label>
		</div>

		<div class="foot">
			<button type="submit" class="btn btn-primary">Save statement</button>
		</div>
	</form>
</Modal>

<style>
	.tax-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: var(--space-5) var(--space-6);
		/* Align at the bottom edge so a two-line label ("Gross income · from 12
		   payslips") doesn't push its input below the row. */
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
	.tax-form input,
	.tax-form select {
		min-width: 0;
	}
	.section-label {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.attach-note {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* Same two columns and gap as `.grid`, so the label/amount split lines up
	 * with the fields in the sections around it. */
	.line {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-6);
	}
	.line-amount {
		display: flex;
		gap: var(--space-4);
		min-width: 0;
	}
	.line-amount input {
		flex: 1 1 auto;
	}
	.add-line {
		align-self: flex-start;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		border-top: 1px solid var(--bd);
		padding-top: 12px;
	}
</style>
