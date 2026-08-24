<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// Four stacked sections, each more specific than the one above it: the band
	// answers "how much, overall", the chart answers "what is the shape", the
	// matrix answers "which year, which country", and the expanded row answers
	// "what exactly did that statement say".
	//
	// The person control sits between the band and the chart. It governs both
	// the chart and the matrix, so it has to precede them; the band stays
	// household-wide, because a figure labelled "overall" that answered to a
	// control beneath it would read backwards.
	import { invalidateAll } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import TaxStatementDialog from '$lib/components/TaxStatementDialog.svelte';
	import TaxSummaryBand from '$lib/components/TaxSummaryBand.svelte';
	import TaxMatrix from '$lib/components/TaxMatrix.svelte';
	import TaxYearDetail from '$lib/components/TaxYearDetail.svelte';
	import TaxYearChart from '$lib/charts/TaxYearChart.svelte';

	let { data, form } = $props();

	type Row = (typeof data.statements)[number];

	// The most recent year is the one a person opening this screen most likely
	// wants, and defaulting it open makes the expansion discoverable without a
	// hint that would otherwise have to be written somewhere.
	let openYear = $state<number | null>(data.years.at(-1)?.year ?? null);
	let mode = $state<'stack' | 'rate'>(data.prefs.mode);
	let personFilter = $state(data.prefs.person);
	let editing = $state<Row | null | 'new'>(null);

	// The server recomputes the year rows when the currency or filer changes —
	// conversion happens at year-end rates, which the client has no table for.
	async function savePrefs(next: { mode?: 'stack' | 'rate'; currency?: string; person?: string }) {
		const body = {
			mode: next.mode ?? mode,
			currency: next.currency ?? data.prefs.currency,
			person: next.person ?? personFilter
		};
		await fetch('/tax/prefs', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		await invalidateAll();
	}

	const statementsFor = (year: number) =>
		data.statements.filter(
			(s) => s.year === year && (personFilter === 'both' || s.personId === personFilter)
		);

	const peopleOptions = $derived([
		{ value: 'both', label: 'Both' },
		...data.people.map((p) => ({ value: p.id, label: p.name }))
	]);
</script>

<ScreenHeader title="Tax" caption="What each yearly statement said — recorded, never computed.">
	{#snippet actions()}
		<button type="button" class="btn btn-primary" onclick={() => (editing = 'new')}>
			Add statement
		</button>
	{/snippet}
</ScreenHeader>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<TaxSummaryBand years={data.years} currency={data.prefs.currency} />

{#if data.people.length > 1}
	<div class="filter">
		<Segmented
			options={peopleOptions}
			bind:value={personFilter}
			onchange={(next) => savePrefs({ person: next })}
		/>
	</div>
{/if}

<TaxYearChart
	years={data.years}
	countries={data.countries}
	currency={data.prefs.currency}
	currencies={data.displayCurrencies}
	bind:mode
	onchange={(next) => savePrefs(next)}
/>

<TaxMatrix
	years={data.years}
	countries={data.countries}
	currency={data.prefs.currency}
	flaggedThreshold={data.flaggedThreshold}
	{openYear}
	onToggle={(year) => (openYear = openYear === year ? null : year)}
>
	{#snippet detail(year)}
		<TaxYearDetail
			statements={statementsFor(year)}
			countries={data.countries}
			onedit={(s) => (editing = s)}
		/>
	{/snippet}
</TaxMatrix>

{#if data.statements.length === 0}
	<p class="empty">
		No statements yet. Add the yearly statement each person received and the history draws itself.
	</p>
{/if}

{#if editing !== null}
	{#key editing === 'new' ? 'new' : editing.id}
		<TaxStatementDialog
			people={data.people}
			taxDocs={data.taxDocs}
			currencies={data.currencies}
			prefillTotals={data.prefillTotals}
			baseCurrency={data.baseCurrency}
			existing={editing === 'new' ? null : editing}
			onclose={() => (editing = null)}
		/>
	{/key}
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
	.filter {
		display: flex;
		justify-content: flex-end;
	}
	.empty {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
