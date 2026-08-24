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
	// Keyed `${documentId}|${field}` — one editor open at a time across the
	// whole screen, so two half-typed corrections can never both be pending.
	let editing = $state<string | null>(null);
	let confirming = $state<string | null>(null);

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
				<span>Gross</span>
				<input name="gross" placeholder="read from the slip if left blank" />
			</label>
			<label>
				<span>Net</span>
				<input name="net" placeholder="read from the slip if left blank" />
			</label>
			<label>
				<span>Bonus</span>
				<input name="bonus" placeholder="part of gross, if the slip names one" />
			</label>
		</div>
		<p class="hint">
			A payslip states gross and net; the bonus is part of gross, so gross 100 000 with a 25 000
			bonus means a base of 75 000. The slip is read for all three and for its month. Anything
			filled in here wins, and a correction teaches the reader for next month.
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
								<a href="/files/{s.file}" target="_blank" rel="noopener" class="s-name">slip</a>
							{:else}
								<span class="s-name muted">no file</span>
							{/if}

							{#each [{ key: 'gross', value: s.gross }, { key: 'net', value: s.net }] as f (f.key)}
								{#if editing === `${s.id}|${f.key}`}
									<form
										method="POST"
										action="?/setPayslipFigure"
										use:enhance={() =>
											async ({ update }) => {
												await update();
												editing = null;
											}}
										class="figure-form"
									>
										<input type="hidden" name="personId" value={p.id} />
										<input type="hidden" name="periodMonth" value={s.periodMonth} />
										<input type="hidden" name="field" value={f.key} />
										<!-- svelte-ignore a11y_autofocus -->
										<input
											name="amount"
											value={f.value ?? ''}
											autofocus
											aria-label="{f.key} for {s.periodMonth}"
										/>
										<button type="submit" class="btn">Save</button>
										<button type="button" class="btn" onclick={() => (editing = null)}>
											Cancel
										</button>
									</form>
								{:else}
									<button
										type="button"
										class="figure"
										class:none={f.value === null}
										onclick={() => (editing = `${s.id}|${f.key}`)}
									>
										<span class="f-label">{f.key}</span>
										<span class="mono">{f.value ?? '—'}</span>
									</button>
								{/if}
							{/each}

							{#if editing === `${s.id}|bonus`}
								<form
									method="POST"
									action="?/setBonus"
									use:enhance={() =>
										async ({ update }) => {
											await update();
											editing = null;
										}}
									class="figure-form"
								>
									<input type="hidden" name="personId" value={p.id} />
									<input type="hidden" name="periodMonth" value={s.periodMonth} />
									<!-- svelte-ignore a11y_autofocus -->
									<input
										name="bonus"
										value={s.bonus ?? ''}
										autofocus
										aria-label="Bonus for {s.periodMonth}"
									/>
									<button type="submit" class="btn">Save</button>
									<button type="button" class="btn" onclick={() => (editing = null)}>
										Cancel
									</button>
								</form>
							{:else}
								<button
									type="button"
									class="figure"
									class:none={s.bonus === null}
									onclick={() => (editing = `${s.id}|bonus`)}
								>
									<span class="f-label">bonus</span>
									<span class="mono">{s.bonus ?? 'none read'}</span>
								</button>
							{/if}

							{#if confirming === s.id}
								<form
									method="POST"
									action="?/deletePayslip"
									use:enhance={() =>
										async ({ update }) => {
											await update();
											confirming = null;
										}}
									class="figure-form"
								>
									<input type="hidden" name="personId" value={p.id} />
									<input type="hidden" name="periodMonth" value={s.periodMonth} />
									<!-- Names what is going. A month evidenced by a bank credit too
									     loses that credit's net figure, and saying so is the
									     difference between a decision and a surprise. -->
									<span class="warn">Delete {s.periodMonth} — gross, net and bonus?</span>
									<button type="submit" class="btn btn-danger">Delete</button>
									<button type="button" class="btn" onclick={() => (confirming = null)}>
										Cancel
									</button>
								</form>
							{:else}
								<button type="button" class="del" onclick={() => (confirming = s.id)}>
									Delete
								</button>
							{/if}
						</div>
					{/each}
				</div>
				<p class="hint">
					Every figure here is editable — click one. A correction teaches the reader the wording for
					next month, and clearing the bonus puts the month back to saying nothing, which is not the
					same as saying zero.
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
	/* A figure is a control, and has to look like one. The v0.4.5 chip was a
	   bordered label at --text-xs, so the hint's promise that "correcting it
	   here remembers the wording" pointed at something that read as static. */
	.figure {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		background: none;
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		color: var(--fg2);
		cursor: pointer;
		padding: 4px 10px;
		font-size: var(--text-sm);
	}
	.figure:hover,
	.figure:focus-visible {
		border-color: var(--blue);
		color: var(--fg1);
	}
	.figure .f-label {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	/* Dashed: the figure is absent, which is a different statement from zero. */
	.figure.none {
		border-style: dashed;
		color: var(--fg3);
	}
	.figure-form {
		display: flex;
		gap: var(--space-3);
		align-items: center;
	}
	.figure-form input {
		width: 120px;
	}
	.del {
		background: none;
		border: none;
		color: var(--fg3);
		cursor: pointer;
		font-size: var(--text-xs);
		padding: 4px 6px;
	}
	.del:hover,
	.del:focus-visible {
		color: var(--red);
	}
	.warn {
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.muted {
		color: var(--fg3);
	}
	.empty {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
