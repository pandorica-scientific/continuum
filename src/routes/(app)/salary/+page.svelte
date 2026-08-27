<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// Band of filters, chart, table — the Tax screen's shape, applied to what was
	// earned rather than what was paid on it.
	//
	// It used to be one repeated block per person: a chart, then a flat list of
	// payslips, once per person, stacked. A second person grew a second
	// everything and there was no way to see the household at all.
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SalaryMatrix from '$lib/components/SalaryMatrix.svelte';
	import SalarySummaryBand from '$lib/components/SalarySummaryBand.svelte';
	import PayslipDialog from '$lib/components/PayslipDialog.svelte';
	import BulkPayslipDialog from '$lib/components/BulkPayslipDialog.svelte';
	import PersonTag from '$lib/components/PersonTag.svelte';
	import SalaryYearChart from '$lib/charts/SalaryYearChart.svelte';
	import type { SalaryMode } from '$lib/charts/salary-chart-geometry';

	let { data } = $props();

	let mode = $state<SalaryMode>('avg');
	let personFilter = $state('both');
	let openYear = $state<number | null>(null);
	// Keyed `${documentId}|${field}` — one editor open at a time across the
	// whole screen, so two half-typed corrections can never both be pending.
	let editing = $state<string | null>(null);
	let confirming = $state<string | null>(null);
	// Its own toggle: the upload form's explainer and this one answer different
	// questions, and opening one to read the other would be a small lie.
	let showSlipHint = $state(false);

	// The dialog holds its own draft and shows its own refusal, so the page no
	// longer has to reopen a collapsed form and refill it. `?add=1` from the
	// quick-add menu is the only thing that opens it from outside.
	let adding = $state(untrack(() => data.openAdd));
	let addingMany = $state(false);

	const peopleOptions = $derived([
		{ value: 'both', label: 'Both' },
		...data.people.map((p) => ({ value: p.id, label: p.name }))
	]);

	const selected = $derived(
		personFilter === 'both' ? null : (data.history.find((p) => p.id === personFilter) ?? null)
	);
	const years = $derived(selected ? selected.years : data.household);
	// Payslips follow the filter; under "Both" every person's are listed, each
	// one carrying whose it is so two Augusts are not mistaken for one.
	const payslips = $derived(
		(selected ? [selected] : data.history).flatMap((p) =>
			p.payslips.map((s) => ({ ...s, personId: p.id, personName: p.name }))
		)
	);
	const slipsFor = (year: number) =>
		payslips.filter((s) => Number(s.periodMonth.slice(0, 4)) === year);

	/**
	 * How many payslips a month holds, so a month holding two can say so.
	 *
	 * Two rows carrying the same month are what two jobs look like, and also what
	 * a mistaken re-upload looks like. Unmarked they read as a duplicate, which is
	 * the wrong conclusion in the first case and an invisible one in the second.
	 *
	 * Counted over EVERY person's slips, not the filtered view, so the count does
	 * not change when the person filter does.
	 */
	const slipsPerMonth = $derived(
		data.history.reduce((held, p) => {
			for (const slip of p.payslips) {
				const key = `${p.id}|${slip.periodMonth}`;
				held.set(key, [...(held.get(key) ?? []), slip.id]);
			}
			return held;
		}, new Map<string, string[]>())
	);
	/**
	 * Which of its month's payslips a row is, and how many there are.
	 *
	 * Both fall out of the one pass above. Re-deriving the position by scanning
	 * `data.history` per rendered row gave the count and the ordinal two ways of
	 * answering the same question, which is two ways of disagreeing.
	 */
	const slipPlace = (personId: string, periodMonth: string, entryId: string) => {
		const held = slipsPerMonth.get(`${personId}|${periodMonth}`) ?? [];
		return { n: held.indexOf(entryId) + 1, of: Math.max(held.length, 1) };
	};

	const anyHistory = $derived(years.length > 0 || payslips.length > 0);

	// The household's colours, not this screen's — see PersonTag.
	const hueFor = (id: string) => data.householdPeople.find((p) => p.id === id)?.hue ?? '--fg3';
</script>

<ScreenHeader
	title="Salary"
	caption="What was earned each month — read from payslips and from the ledger."
>
	{#snippet actions()}
		<button type="button" class="btn" onclick={() => (addingMany = !addingMany)}>
			Add several
		</button>
		<button type="button" class="btn btn-primary" onclick={() => (adding = !adding)}>
			Add payslip
		</button>
	{/snippet}
</ScreenHeader>

{#if addingMany}
	<BulkPayslipDialog
		people={data.people}
		currencies={data.currencies}
		onclose={() => (addingMany = false)}
	/>
{/if}

{#if adding}
	<PayslipDialog
		people={data.people}
		currencies={data.currencies}
		baseCurrency={data.baseCurrency}
		onclose={() => (adding = false)}
	/>
{/if}

<SalarySummaryBand {years} currency={data.baseCurrency} scope={selected ? 'person' : 'household'} />

{#if data.people.length > 1}
	<div class="filter">
		<Segmented options={peopleOptions} bind:value={personFilter} />
	</div>
{/if}

<SalaryYearChart
	{years}
	currency={data.baseCurrency}
	bind:mode
	onchange={(next) => (mode = next)}
/>

<SalaryMatrix
	{years}
	currency={data.baseCurrency}
	{openYear}
	onToggle={(year) => (openYear = openYear === year ? null : year)}
>
	{#snippet detail(year)}
		{@const slips = slipsFor(year)}
		<div class="slips">
			{#if slips.length > 0}
				{#each slips as s (s.id)}
					{@const place = slipPlace(s.personId, s.periodMonth, s.id)}
					<!-- On the table's own grid, so a month's figures sit directly under
					     the column each one belongs to. They used to be laid on a
					     three-column grid with six children in it, which wrapped them
					     onto two lines and stretched the bonus across a whole fraction. -->
					<div class="slip">
						<span class="month">
							<span class="mono">{s.periodMonth}</span>
							<!-- The word "slip" said nothing the paperclip does not: every row
							     in this table IS a slip. The icon is the link, and whose month
							     it is takes the space the word had. -->
							{#if s.file}
								<a
									href="/files/{s.file}"
									target="_blank"
									rel="noopener"
									class="s-file"
									data-file-name="Payslip {s.periodMonth} · {s.personName}"
									aria-label="Open the payslip for {s.periodMonth}">📎</a
								>
							{:else}
								<span class="s-file quiet" title="No file was uploaded for this month">—</span>
							{/if}
							{#if data.people.length > 1}
								<PersonTag name={s.personName} hue={hueFor(s.personId)} />
							{/if}
							{#if place.of > 1}
								<!-- Named rather than left to be inferred from a repeated month. -->
								<span
									class="s-many"
									title="{s.periodMonth} has {place.of} payslips — one per job. The year row adds them together."
								>
									{place.n} of {place.of}
								</span>
							{/if}
						</span>

						<!-- Base is gross with the award taken out. It was read-only for
						     that reason — a derived figure has to decide which input it
						     writes — and being unable to correct the one figure a person
						     actually knows was worse than deciding. It writes gross and
						     leaves the award alone. -->
						<span class="f-slot">
							{#if editing === `${s.id}|base`}
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
									<input type="hidden" name="entryId" value={s.id} />
									<input type="hidden" name="field" value="base" />
									<!-- svelte-ignore a11y_autofocus -->
									<input
										name="amount"
										value={s.base ?? ''}
										autofocus
										aria-label="base for {s.periodMonth}"
									/>
									<button type="submit" class="btn">Save</button>
									<button type="button" class="btn" onclick={() => (editing = null)}>Cancel</button>
								</form>
							{:else}
								<button
									type="button"
									class="figure"
									class:none={s.base === null}
									title="gross less the bonus — saving this sets gross"
									onclick={() => (editing = `${s.id}|base`)}
								>
									{s.base ?? '—'}{#if s.base !== null}<span class="cur">{s.currency}</span>{/if}
								</button>
							{/if}
						</span>

						{#each [{ key: 'bonus', value: s.bonus, action: '?/setBonus', field: 'bonus' }, { key: 'gross', value: s.gross, action: '?/setPayslipFigure', field: 'amount' }] as f (f.key)}
							<span class="f-slot" class:gross={f.key === 'gross'}>
								{#if editing === `${s.id}|${f.key}`}
									<form
										method="POST"
										action={f.action}
										use:enhance={() =>
											async ({ update }) => {
												await update();
												editing = null;
											}}
										class="figure-form"
									>
										<input type="hidden" name="entryId" value={s.id} />
										{#if f.key !== 'bonus'}
											<input type="hidden" name="field" value={f.key} />
										{/if}
										<!-- svelte-ignore a11y_autofocus -->
										<input
											name={f.field}
											value={f.value ?? ''}
											autofocus
											aria-label="{f.key} for {s.periodMonth}"
										/>
										<button type="submit" class="btn">Save</button>
										<button type="button" class="btn" onclick={() => (editing = null)}>
											Cancel
										</button>
									</form>
								{:else if f.value === null}
									<button
										type="button"
										class="figure none"
										onclick={() => (editing = `${s.id}|${f.key}`)}
									>
										{f.key === 'bonus' ? 'not itemised' : '—'}
									</button>
								{:else}
									<button
										type="button"
										class="figure"
										class:strong={f.key === 'gross'}
										onclick={() => (editing = `${s.id}|${f.key}`)}
									>
										{f.value}<span class="cur">{s.currency}</span>
									</button>
								{/if}
							</span>
						{/each}

						<!-- A month has no monthly average of its own, so the column that
						     holds one on a year row holds this month's actions instead —
						     behind a ⋯, the same gesture the Tax screen uses. -->
						<span class="f-slot">
							<div class="menu-wrap">
								<button
									type="button"
									class="figure dots"
									aria-label="More for {s.periodMonth}"
									aria-expanded={confirming === s.id}
									onclick={() => (confirming = confirming === s.id ? null : s.id)}>···</button
								>
								{#if confirming === s.id}
									<div class="menu">
										<!-- Correcting the currency, not converting it: the figures
										     are the digits printed on the slip and only the name
										     attached to them was wrong. Every month filed before
										     v0.5.1 carries the household's base currency rather than
										     what the slip said, and the file it was read from may be
										     long gone — so this has to be fixable without one. -->
										<form
											method="POST"
											action="?/setPayslipCurrency"
											use:enhance={() =>
												async ({ update }) => {
													await update();
													confirming = null;
												}}
											class="menu-form"
										>
											<input type="hidden" name="entryId" value={s.id} />
											<span class="menu-label">Paid in</span>
											<select
												name="currency"
												value={s.currencyCode}
												aria-label="Currency for {s.periodMonth}"
											>
												{#each data.currencies as code (code)}
													<option value={code}>{code}</option>
												{/each}
											</select>
											<button type="submit" class="btn">Set</button>
										</form>
									</div>
									<form
										method="POST"
										action="?/deletePayslip"
										use:enhance={() =>
											async ({ update }) => {
												await update();
												confirming = null;
											}}
										class="menu menu-lower"
									>
										<input type="hidden" name="entryId" value={s.id} />
										<!-- Names what is going. A month evidenced by a bank credit
										     too loses that credit's net figure, and saying so is the
										     difference between a decision and a surprise. -->
										<button type="submit" class="menu-item danger">
											Delete {s.periodMonth} — gross, net and bonus
										</button>
									</form>
								{/if}
							</div>
						</span>

						<span class="f-slot divide">
							{#if editing === `${s.id}|net`}
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
									<input type="hidden" name="entryId" value={s.id} />
									<input type="hidden" name="field" value="net" />
									<!-- svelte-ignore a11y_autofocus -->
									<input
										name="amount"
										value={s.net ?? ''}
										autofocus
										aria-label="net for {s.periodMonth}"
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
									class:none={s.net === null}
									onclick={() => (editing = `${s.id}|net`)}
								>
									{s.net ?? '—'}{#if s.net !== null}<span class="cur">{s.currency}</span>{/if}
								</button>
							{/if}
						</span>
					</div>
				{/each}

				<div class="slips-foot">
					<!-- Behind an ⓘ, like the upload form's explainer: it is read once and
					     skipped on every expand after, and a paragraph that repeats under
					     each open year is noise the table has to be read around. -->
					<button
						type="button"
						class="icon-btn"
						aria-expanded={showSlipHint}
						aria-label="How to correct a figure"
						onclick={() => (showSlipHint = !showSlipHint)}
					>
						<Icon name="info" size={14} />
					</button>
					{#if showSlipHint}
						<p class="hint">
							Every figure is editable — click one. A correction teaches the reader the wording for
							next month; clearing a bonus puts the month back to saying nothing, which is not the
							same as saying zero.
						</p>
					{/if}
					<span class="count mono"
						>{slips.length} {slips.length === 1 ? 'payslip' : 'payslips'}</span
					>
				</div>
			{:else}
				<div class="slips-foot">
					<p class="hint">No payslip filed for {year} — this year came from the ledger.</p>
				</div>
			{/if}
		</div>
	{/snippet}
</SalaryMatrix>

{#if !anyHistory}
	<p class="empty">
		Nothing recorded yet. Add a payslip above, or categorise a salary credit on the Transactions
		screen, and the history builds itself.
	</p>
{/if}

<style>
	.filter {
		display: flex;
		justify-content: center;
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--fg3);
		margin: 0;
	}
	/* The expanded year's payslips, indented under its row the way the Tax
	   matrix indents a year's statements. */
	/* The expanded year's payslips, on the table's own grid rather than indented
	   inside a card — so the columns line up with the year row above them. */
	.slips {
		background: var(--card2);
		border-bottom: 1px solid var(--bd2);
	}
	.slips-foot {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding: 8px var(--space-6) 12px;
	}
	.slips-foot .hint {
		flex: 1;
		min-width: 0;
	}
	/* Pushed right whether or not the hint is showing. */
	.slips-foot .count {
		margin-left: auto;
	}
	.count {
		font-size: var(--text-xs);
		color: var(--fg3);
		white-space: nowrap;
	}
	/* Same grid as the table above. `--row-cols` and `--row-min` are set on the
	   matrix and inherit down to here, so a month's figures land under the column
	   each belongs to and cannot fall out of step with the header. */
	.slip {
		display: grid;
		grid-template-columns: var(--row-cols);
		align-items: center;
		gap: var(--space-5);
		padding: 6px var(--space-6);
		min-width: var(--row-min);
		border-bottom: 1px solid var(--bd2);
	}
	.slip:last-of-type {
		border-bottom: 0;
	}
	.f-slot {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
		min-width: 0;
	}
	/* The one rule down the table, kept in step with the matrix header above:
	   centred in the gutter, not pulled to its far edge. */
	.f-slot.divide {
		border-left: 1px solid var(--bd2);
		padding-left: calc(var(--space-5) / 2);
		margin-left: calc(var(--space-5) / -2);
	}
	.menu-wrap {
		position: relative;
	}
	.menu {
		position: absolute;
		right: 0;
		top: 100%;
		z-index: 2;
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
		overflow: hidden;
	}
	.menu-item {
		display: block;
		width: 100%;
		background: none;
		border: 0;
		cursor: pointer;
		padding: 8px 14px;
		font-size: var(--text-sm);
		text-align: left;
		white-space: nowrap;
		color: var(--fg1);
	}
	.menu-item.danger {
		color: var(--red);
	}
	.menu-item:hover {
		background: var(--bd);
	}
	/* The delete form sits under the currency one rather than on top of it —
	   both are absolutely positioned off the same ⋯. */
	.menu-lower {
		top: calc(100% + 44px);
	}
	.menu-form {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 6px 8px;
	}
	.menu-label {
		font-size: var(--text-xs);
		color: var(--fg3);
		white-space: nowrap;
	}
	.menu-form select {
		min-width: 0;
	}
	/* The month, then what it was read from and whose it is. Wrapping rather
	   than stacking: the tag is a chip on the same line as the paperclip when
	   there is room for it, and drops under the month when there is not. */
	.month {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 6px;
		font-size: var(--text-sm);
		color: var(--fg2);
		min-width: 0;
	}
	.quiet {
		color: var(--fg3);
		opacity: 0.7;
	}
	/* A month evidenced more than once. Neutral, not a warning: two jobs is an
	   ordinary thing for a month to be, and the row is only saying which. */
	.s-many {
		font-size: var(--text-xs);
		color: var(--fg3);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-xl);
		padding: 1px 7px;
		line-height: 1.4;
		white-space: nowrap;
	}
	.s-file {
		font-size: var(--text-sm);
		line-height: 1;
		text-decoration: none;
		color: var(--fg2);
	}
	.s-file:hover {
		color: var(--fg1);
	}
	/* The unit beside every figure on a slip row, the way the Tax screen prints
	   a statement's. Dimmer and smaller than the number it belongs to: it is the
	   same on all four figures in the row, so it must not compete with the one
	   thing that differs between them. */
	.cur {
		margin-left: 4px;
		font-size: var(--text-xs);
		font-weight: 400;
		color: var(--fg3);
	}
	/* A figure is a control, and has to look like one. The v0.4.5 chip was a
	   bordered label at --text-xs, so the hint's promise that "correcting it
	   here remembers the wording" pointed at something that read as static. */
	/* A figure is a control, and has to look like one. The v0.4.5 chip was a
	   bordered label at --text-xs, so the hint's promise that "correcting it
	   here remembers the wording" pointed at something that read as static. */
	.figure {
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--fg1);
		cursor: pointer;
		padding: 3px 8px;
		font-size: var(--text-sm);
		font-family: var(--font-mono);
		white-space: nowrap;
	}
	.figure:hover,
	.figure:focus-visible {
		border-color: var(--blue);
	}
	/* The year total column, so it carries the same weight the row above does. */
	.figure.strong {
		color: var(--fg1);
		font-size: var(--text-md);
		font-weight: 600;
	}
	.figure.dots {
		color: var(--fg3);
		letter-spacing: 0.12em;
		border-color: var(--bd2);
	}
	/* Dotted: the figure is absent, which is a different statement from zero. */
	.figure.none {
		border-color: var(--bd2);
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
	.empty {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
