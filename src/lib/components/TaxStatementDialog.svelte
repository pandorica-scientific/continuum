<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';

	interface Existing {
		id: string;
		personId: string;
		year: number;
		country: string;
		currencyCode: string;
		gross: string;
		taxPaid: string;
		lines: { label: string; amount: string }[];
		documentId: string | null;
		note: string | null;
	}

	let {
		people,
		taxDocs,
		prefillTotals,
		baseCurrency,
		existing,
		onclose
	}: {
		people: { id: string; name: string }[];
		taxDocs: { id: string; name: string }[];
		prefillTotals: Record<string, { amount: string; months: number }>;
		baseCurrency: string;
		existing: Existing | null;
		onclose: () => void;
	} = $props();

	let personId = $state(existing?.personId ?? (people[0]?.id || ''));
	let year = $state(String(existing?.year ?? new Date().getFullYear() - 1));
	let country = $state(existing?.country ?? '');
	let currency = $state(existing?.currencyCode ?? baseCurrency);
	let gross = $state(existing?.gross ?? '');
	let taxPaid = $state(existing?.taxPaid ?? '');
	let note = $state(existing?.note ?? '');
	let documentId = $state(existing?.documentId ?? '');
	let lines = $state(
		existing?.lines.map((l) => ({ label: l.label, amount: l.amount })) ?? [
			{ label: '', amount: '' }
		]
	);

	// Prefill applies while creating, and stops the moment the gross field is
	// touched. Editing an existing statement never prefills: a saved figure is
	// never re-derived. That rule is what the E2E reload test pins.
	let grossTouched = $state(existing !== null);
	const suggestion = $derived(prefillTotals[`${personId}|${Number(year)}`] ?? null);
	$effect(() => {
		if (!grossTouched) gross = suggestion?.amount ?? '';
	});
</script>

<Modal title={existing ? 'Edit statement' : 'Add statement'} {onclose}>
	<form
		method="POST"
		action="?/save"
		use:enhance={() =>
			async ({ update }) => {
				await update();
				onclose();
			}}
		class="tax-form"
	>
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
				<input name="currency" placeholder="CZK" bind:value={currency} />
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
				<input name="lineAmount" placeholder="0" inputmode="decimal" bind:value={line.amount} />
				{#if lines.length > 1}
					<button
						type="button"
						class="btn"
						onclick={() => (lines = lines.filter((_, j) => j !== i))}
						aria-label="Remove line {i + 1}">✕</button
					>
				{/if}
			</div>
		{/each}
		<button
			type="button"
			class="btn add-line"
			onclick={() => (lines = [...lines, { label: '', amount: '' }])}
		>
			＋ Add line
		</button>

		<div class="grid">
			<label>
				<span>Statement document (Tax shelf)</span>
				<select name="documentId" bind:value={documentId}>
					<option value="">None attached</option>
					{#each taxDocs as d (d.id)}
						<option value={d.id}>{d.name}</option>
					{/each}
				</select>
			</label>
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
		gap: 12px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		color: var(--fg3);
	}
	.tax-form input,
	.tax-form select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
		min-width: 0;
	}
	.section-label {
		font-size: 12px;
		color: var(--fg3);
	}
	.line {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
		gap: 8px;
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
