<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import TaxStatementDialog from '$lib/components/TaxStatementDialog.svelte';
	import TaxCharts from '$lib/charts/TaxCharts.svelte';

	let { data, form } = $props();

	type Row = (typeof data.statements)[number];
	let editing = $state<Row | null | 'new'>(null);

	// Person → country → statements, newest year first (already sorted).
	const grouped = $derived(
		[...new Set(data.statements.map((s) => s.personName))].map((personName) => ({
			personName,
			countries: [
				...new Set(data.statements.filter((s) => s.personName === personName).map((s) => s.country))
			].map((country) => ({
				country,
				rows: data.statements.filter((s) => s.personName === personName && s.country === country)
			}))
		}))
	);
</script>

<ScreenHeader title="Tax" caption="What each yearly statement said — recorded, never computed." />

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<section class="section">
	<div class="eyebrow-row">
		<Eyebrow emoji="🧾" label="Statements" />
		<span class="eyebrow-caption">
			{data.statements.length}
			{data.statements.length === 1 ? 'statement' : 'statements'}
		</span>
	</div>
	<div class="toolbar">
		<button type="button" class="btn btn-primary" onclick={() => (editing = 'new')}>
			Add statement
		</button>
	</div>

	{#each grouped as g (g.personName)}
		{#each g.countries as c (c.country)}
			<div class="group-head">
				<span class="g-name">{g.personName} · {c.country}</span>
			</div>
			{#each c.rows as s (s.id)}
				<div class="card tax-row">
					<div class="t-facts">
						<span class="mono t-year">{s.year}</span>
						<div class="t-mid">
							<span class="t-figures">
								gross <strong class="mono">{s.gross} {s.currency}</strong>
								· tax <strong class="mono">{s.taxPaid} {s.currency}</strong>
								{#if s.ratePct !== null}
									· <span class="t-rate mono">{s.ratePct}%</span> effective
								{/if}
							</span>
							{#if s.lines.length > 0}
								<span class="t-lines">
									{#each s.lines as l, i (i)}
										<span>{l.label} {l.amount}</span>
									{/each}
								</span>
							{/if}
							{#if s.documentName}
								<span class="t-doc">🗂️ {s.documentName}</span>
							{/if}
							{#if s.note}<span class="t-note">{s.note}</span>{/if}
							{#if s.diverges}<span class="t-diverges">{s.diverges}</span>{/if}
						</div>
					</div>
					<div class="t-actions">
						<button type="button" class="btn" onclick={() => (editing = s)}>Edit</button>
						<form method="POST" action="?/remove" use:enhance>
							<input type="hidden" name="id" value={s.id} />
							<button type="submit" class="btn">Delete</button>
						</form>
					</div>
				</div>
			{/each}
		{/each}
	{/each}

	{#if data.statements.length === 0}
		<p class="empty">
			No statements yet. Add the yearly statement each person received and the history draws itself.
		</p>
	{/if}
</section>

{#if data.series.length > 0}
	<TaxCharts series={data.series} />
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
	.toolbar {
		display: flex;
	}
	.group-head {
		margin-top: 6px;
	}
	.g-name {
		font-size: var(--text-sm);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--fg3);
	}
	.tax-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
	}
	.t-facts {
		display: flex;
		align-items: baseline;
		gap: var(--space-7);
		flex: 1 1 340px;
		min-width: 0;
	}
	.t-year {
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.t-mid {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.t-figures {
		font-size: var(--text-md);
	}
	.t-rate {
		color: var(--green);
	}
	.t-lines,
	.t-doc,
	.t-note {
		font-size: var(--text-sm);
		color: var(--fg3);
		display: flex;
		gap: var(--space-6);
		flex-wrap: wrap;
	}
	.t-diverges {
		font-size: var(--text-sm);
		color: var(--yellow);
	}
	.t-actions {
		display: flex;
		gap: var(--space-4);
	}
	.empty {
		color: var(--fg3);
		font-size: var(--text-md);
	}
</style>
