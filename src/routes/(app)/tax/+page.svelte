<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import TaxStatementDialog from '$lib/components/TaxStatementDialog.svelte';
	import SummaryBand from '$lib/components/SummaryBand.svelte';
	import { taxSummaryTiles } from '$lib/tax-tiles';
	import TaxMatrix from '$lib/components/TaxMatrix.svelte';
	import TaxYearDetail from '$lib/components/TaxYearDetail.svelte';
	import TaxYearChart from '$lib/charts/TaxYearChart.svelte';

	let { data, form } = $props();

	type Row = (typeof data.statements)[number];

	// The three below read the load once (untrack) and belong to the screen
	// afterwards: `savePrefs` reloads the page data, and a re-read would snap
	// an expanded year shut while it was being read.
	let openYear = $state<number | null>(null);
	let mode = $state<'stack' | 'rate'>(untrack(() => data.prefs.mode));
	let personFilter = $state(untrack(() => data.prefs.person));
	// ?add=1 from the quick-add menu opens the dialog on arrival.
	let editing = $state<Row | null | 'new'>(untrack(() => (data.openAdd ? 'new' : null)));

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

<SummaryBand tiles={taxSummaryTiles(data.years, data.prefs.currency)} />

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
			personHue={(id) => data.householdPeople.find((p) => p.id === id)?.hue ?? '--fg3'}
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
			defaults={data.addDefaults}
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
