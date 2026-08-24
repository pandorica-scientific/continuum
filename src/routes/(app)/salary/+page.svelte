<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// One person per block: the chart, then the years, then the payslips it read
	// them from. Two people are two blocks rather than two overlaid series —
	// salaries are not compared against each other, they are read one at a time.
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import SalaryYearChart from '$lib/charts/SalaryYearChart.svelte';
	import type { SalaryMode } from '$lib/charts/salary-chart-geometry';

	let { data, form } = $props();

	let adding = $state(false);
	let mode = $state<SalaryMode>('avg');
	let editingBonus = $state<string | null>(null);

	const anyHistory = $derived(data.history.some((p) => p.years.length > 0));
	// A person with nothing recorded gets no block. An empty chart and an empty
	// payslip list say only that the screen works, and a household where one
	// person has never been paid through it would carry that noise forever.
	const withHistory = $derived(
		data.history.filter((p) => p.years.length > 0 || p.payslips.length > 0)
	);
</script>

<ScreenHeader
	title="Salary"
	caption="What was earned each month — read from payslips and from the ledger."
>
	{#snippet actions()}
		<button type="button" class="btn btn-primary" onclick={() => (adding = !adding)}>
			Add payslip
		</button>
	{/snippet}
</ScreenHeader>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

{#if adding}
	<form
		method="POST"
		action="?/addPayslip"
		use:enhance={() =>
			async ({ update }) => {
				await update();
				adding = false;
			}}
		enctype="multipart/form-data"
		class="card add-form"
	>
		<div class="grid">
			<label>
				<span>Whose</span>
				<select name="personId">
					{#each data.people as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</label>
			<label>
				<span>Payslip PDF</span>
				<input type="file" name="file" accept=".pdf" />
			</label>
			<label>
				<span>Month</span>
				<input type="month" name="periodMonth" />
			</label>
			<label>
				<span>Amount</span>
				<input name="amount" placeholder="read from the slip if left blank" />
			</label>
		</div>
		<p class="hint">
			The slip is read for its amount, its month and any bonus line. Anything filled in here wins,
			and a correction teaches the reader for next month.
		</p>
		<div class="row">
			<button type="submit" class="btn btn-primary">Add</button>
			<button type="button" class="btn" onclick={() => (adding = false)}>Cancel</button>
		</div>
	</form>
{/if}

{#each withHistory as p (p.id)}
	<section class="person">
		<div class="eyebrow-row">
			<Eyebrow emoji="💼" label={p.name} />
			<span class="eyebrow-caption">
				{p.years.length}
				{p.years.length === 1 ? 'year' : 'years'} · {p.payslips.length}
				{p.payslips.length === 1 ? 'payslip' : 'payslips'}
			</span>
		</div>

		<SalaryYearChart
			years={p.years}
			currency={data.baseCurrency}
			bind:mode
			onchange={(next) => (mode = next)}
		/>

		{#if p.payslips.length > 0}
			<div class="card slips">
				<span class="section-label">Payslips</span>
				<div class="slip-list">
					{#each p.payslips as s (s.id)}
						<div class="slip">
							<span class="mono month">{s.periodMonth}</span>
							{#if s.file}
								<a href="/files/{s.file}" target="_blank" rel="noopener" class="s-name">
									{s.amount}
									{s.currency}
								</a>
							{:else}
								<span class="s-name">{s.amount} {s.currency}</span>
							{/if}

							{#if editingBonus === s.id}
								<form
									method="POST"
									action="?/setBonus"
									use:enhance={() =>
										async ({ update }) => {
											await update();
											editingBonus = null;
										}}
									class="bonus-form"
								>
									<input type="hidden" name="personId" value={p.id} />
									<input type="hidden" name="periodMonth" value={s.periodMonth} />
									<input
										name="bonus"
										value={s.bonus ?? ''}
										placeholder="bonus"
										aria-label="Bonus for {s.periodMonth}"
									/>
									<button type="submit" class="btn">Save</button>
									<button type="button" class="btn" onclick={() => (editingBonus = null)}>
										Cancel
									</button>
								</form>
							{:else}
								<button
									type="button"
									class="bonus"
									class:none={s.bonus === null}
									onclick={() => (editingBonus = s.id)}
								>
									{s.bonus === null ? 'no bonus read' : `bonus ${s.bonus}`}
								</button>
							{/if}
						</div>
					{/each}
				</div>
				<p class="hint">
					A bonus is read from the slip when it names one. Correcting it here remembers the wording
					for next month, and clearing the field puts the month back to saying nothing.
				</p>
			</div>
		{/if}
	</section>
{/each}

{#if !anyHistory}
	<p class="empty">
		Nothing recorded yet. Add a payslip above, or categorise a salary credit on the Transactions
		screen, and the history builds itself.
	</p>
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
	.person {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.add-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: var(--space-6);
	}
	.row {
		display: flex;
		gap: var(--space-4);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--fg3);
		margin: 0;
	}
	.slips {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.section-label {
		font-size: var(--text-xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg3);
	}
	.slip-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.slip {
		display: grid;
		grid-template-columns: 84px minmax(0, 1fr) auto;
		gap: var(--space-4);
		align-items: center;
		padding: 6px 0;
		border-bottom: 1px solid var(--bd);
	}
	.month {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.s-name {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.bonus {
		background: none;
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		color: var(--fg2);
		cursor: pointer;
		padding: 4px 10px;
		font-size: var(--text-xs);
	}
	.bonus.none {
		color: var(--fg3);
		border-style: dashed;
	}
	.bonus-form {
		display: flex;
		gap: var(--space-3);
		align-items: center;
	}
	.bonus-form input {
		width: 120px;
	}
	.empty {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
