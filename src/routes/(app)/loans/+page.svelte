<script lang="ts">
	import { enhance } from '$app/forms';
	import TagInput from '$lib/components/TagInput.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import MetricTile from '$lib/components/MetricTile.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import LoanSchedule from '$lib/charts/LoanSchedule.svelte';
	import RepayDialog from '$lib/components/RepayDialog.svelte';
	import RefixDialog from '$lib/components/RefixDialog.svelte';
	import { DAY_COUNTS, DAY_COUNT_LABELS } from '$lib/loans';

	let { data, form } = $props();

	let adding = $state(false);
	let regime = $state('fixed_period');
	let open = $state<string | null>(null);
	let repayFor = $state<string | null>(null);
	let refixFor = $state<string | null>(null);
</script>

<ScreenHeader
	title="Loans"
	caption="Every rate regime on record — a re-fix never rewrites booked interest."
/>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<section class="section">
	<div class="eyebrow-row">
		<Eyebrow emoji="💳" label="What you owe" />
		<span class="eyebrow-caption">
			{data.count === 0
				? 'no loans on record yet'
				: `${data.count} loan${data.count === 1 ? '' : 's'}`}
		</span>
	</div>
	<div class="tiles">
		<MetricTile
			label="Total owed"
			value={data.metrics.totalOwed}
			unit={data.unit}
			color="var(--red)"
		/>
		<MetricTile label="Monthly payments" value={data.metrics.monthlyPayments} unit={data.unit} />
		<MetricTile
			label="Interest this year"
			value={data.metrics.interestThisYear}
			unit={data.unit}
			color="var(--orange)"
			note={data.metrics.interestNote}
		/>
		<MetricTile
			label="Debt-free"
			value={data.metrics.debtFree ? String(data.metrics.debtFree) : '—'}
			note="at current payments"
		/>
	</div>
</section>

<section class="section" style="gap: 12px;">
	{#each data.loans as l (l.id)}
		<div class="card loan">
			<div class="head">
				<div class="names">
					<span class="name">{l.name}</span>
					<span class="sub">{l.sub}</span>
				</div>
				<Pill hue={l.pill.hue}>{l.pill.label}</Pill>
			</div>
			<div class="l-tags">
				{#each l.tags as t (t)}
					<form method="POST" action="?/tags" use:enhance class="tag-chip">
						<input type="hidden" name="id" value={l.id} />
						<input type="hidden" name="removeTag" value={t} />
						<span>{t}</span>
						<button type="submit" aria-label="Remove tag {t}">✕</button>
					</form>
				{/each}
				<form method="POST" action="?/tags" use:enhance>
					<input type="hidden" name="id" value={l.id} />
					<TagInput transactionId={l.id} known={data.knownTags ?? []} />
				</form>
			</div>
			<div class="facts">
				{#each l.facts as f (f.label)}
					<div class="fact">
						<span class="f-label">{f.label}</span>
						<span class="mono f-value" style:color={f.color}>{f.value}</span>
					</div>
				{/each}
			</div>
			<div class="progress">
				<div class="track"><div class="fill" style:width="{l.paidPct}%"></div></div>
				<span class="note"
					>{l.paidNote}{l.monthInterest ? ` · ${l.monthInterest} interest this month` : ''}</span
				>
			</div>
			<button
				type="button"
				class="detail-toggle"
				onclick={() => (open = open === l.id ? null : l.id)}
			>
				{open === l.id ? 'Hide schedule & changes ▴' : 'Schedule & changes ▾'}
			</button>
			{#if open === l.id}
				<div class="detail">
					{#if l.chart.length}
						<div class="eyebrow-row">
							<Eyebrow emoji="📊" label="Interest vs principal" />
							<span class="eyebrow-caption">{l.chartNote}</span>
						</div>
						<LoanSchedule years={l.chart} currency={l.currency} />
					{/if}
					<div class="actions-row">
						<button type="button" class="btn" onclick={() => (repayFor = l.id)}>
							💸 Record a repayment…
						</button>
						<button type="button" class="btn" onclick={() => (refixFor = l.id)}>
							🔁 New fixation…
						</button>
						<span class="mini-note">both preview their effect on the chart before saving</span>
					</div>
					{#if l.events.length}
						<div class="events">
							<span class="mini-title">📜 What happened on this loan</span>
							{#each l.events as e (e.id)}
								<div class="event">
									<span class="mono e-date">{e.date}</span>
									<span class="e-label">{e.label}{e.note ? ` · ${e.note}` : ''}</span>
									<span class="mono e-amount">{e.amount}</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
			{#if repayFor === l.id}
				<RepayDialog
					loanId={l.id}
					currency={l.currency}
					sim={l.sim}
					onclose={() => (repayFor = null)}
				/>
			{/if}
			{#if refixFor === l.id}
				<RefixDialog
					loanId={l.id}
					currency={l.currency}
					sim={l.sim}
					onclose={() => (refixFor = null)}
				/>
			{/if}
		</div>
	{/each}

	{#if adding}
		<form method="POST" action="?/addLoan" use:enhance class="card add-form">
			<div class="grid">
				<label><span>Name</span><input name="name" placeholder="Mortgage · Karlín" /></label>
				<label><span>Lender</span><input name="lender" placeholder="Česká spořitelna" /></label>
				<label
					><span>Kind</span>
					<select name="kind">
						<option value="mortgage">Mortgage</option>
						<option value="car">Car</option>
						<option value="consumer">Consumer</option>
						<option value="family">Family</option>
					</select></label
				>
				<label
					><span>Currency</span>
					<select name="currency"
						>{#each data.currencies as c (c)}<option>{c}</option>{/each}</select
					></label
				>
				<label
					><span>Original principal</span><input
						name="principal"
						inputmode="decimal"
						placeholder="5 600 000"
					/></label
				>
				<label
					><span>Owed now</span><input
						name="owed"
						inputmode="decimal"
						placeholder="4 120 000"
					/></label
				>
				<label
					><span>Monthly payment</span><input
						name="payment"
						inputmode="decimal"
						placeholder="35 000"
					/></label
				>
				<label
					><span>Annual rate %</span><input
						name="rate"
						inputmode="decimal"
						placeholder="4.29"
					/></label
				>
				<label
					><span>Rate regime</span>
					<select name="regime" bind:value={regime}>
						<option value="fixed_period">Fixed until a date, then re-fixed</option>
						<option value="fixed_term">Fixed for the whole term</option>
						<option value="floating">Floating</option>
					</select></label
				>
				{#if regime === 'fixed_period'}
					<label><span>Fixation ends</span><input name="fixedUntil" type="date" /></label>
				{/if}
				<label
					><span>Interest charged</span>
					<select name="accrualStyle">
						<option value="payment">with each payment (payment period)</option>
						<option value="calendar">at month end (calendar month, e.g. Česká spořitelna)</option>
					</select></label
				>
				<label
					><span>Interest accrual</span>
					<select name="dayCount">
						{#each DAY_COUNTS as dc (dc)}
							<option value={dc}>{DAY_COUNT_LABELS[dc]}</option>
						{/each}
					</select></label
				>
				<label
					><span>Payment day of month</span><input
						name="paymentDay"
						inputmode="numeric"
						placeholder="15"
					/></label
				>
				<label><span>Started</span><input name="startsOn" type="date" /></label>
				<label><span>Ends (contract)</span><input name="endsOn" type="date" /></label>
			</div>
			{#if data.properties.length}
				<fieldset class="secured">
					<legend
						>Secured by — one agreement can cover several flats; give each its share of the debt</legend
					>
					{#each data.properties as p (p.id)}
						<div class="secured-row">
							<label class="toggle">
								<input type="checkbox" name={`secured_${p.id}`} />
								<span>{p.name}</span>
							</label>
							<input
								name={`share_${p.id}`}
								inputmode="decimal"
								placeholder="share % (blank = by value)"
							/>
						</div>
					{/each}
				</fieldset>
			{/if}
			<label class="toggle">
				<input type="checkbox" name="deductible" />
				<span>Interest is tax deductible (owner-occupied mortgage)</span>
			</label>
			<div class="row">
				<button type="submit" class="btn btn-primary">Add loan</button>
				<button type="button" class="btn" onclick={() => (adding = false)}>Cancel</button>
			</div>
		</form>
	{:else}
		<button type="button" class="add-tile" onclick={() => (adding = true)}>
			<span class="a-title">➕ Add loan</span>
			<span class="a-note"
				>Mortgage, car, consumer, or a loan to family. Payments then match themselves from your
				statements.</span
			>
		</button>
	{/if}
</section>

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 12px;
	}
	.loan {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}
	.names {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.name {
		font-size: 15px;
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: var(--fg3);
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
		gap: 12px;
	}
	.fact {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.f-label {
		font-size: 11px;
		color: var(--fg3);
	}
	.f-value {
		font-size: 14px;
	}
	.progress {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.track {
		height: 8px;
		background: var(--card3);
		border-radius: 4px;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--green);
		border-radius: 4px;
	}
	.note {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.detail-toggle {
		align-self: flex-start;
		border: 0;
		background: transparent;
		color: var(--blue);
		font-size: 12.5px;
		cursor: pointer;
		padding: 0;
	}
	.detail {
		display: flex;
		flex-direction: column;
		gap: 16px;
		border-top: 1px solid var(--bd);
		padding-top: 14px;
	}
	.actions-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.mini-title {
		font-size: 13px;
		font-weight: 500;
		color: var(--fg1);
	}
	.mini-note {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.events {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.event {
		display: grid;
		grid-template-columns: 86px minmax(0, 1fr) auto;
		gap: 12px;
		align-items: baseline;
		padding: 7px 0;
		border-bottom: 1px solid var(--bd);
		font-size: 13px;
	}
	.e-date {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.e-label {
		color: var(--fg2);
	}
	.e-amount {
		font-size: 12.5px;
	}
	.add-tile {
		border: 1.5px dashed var(--bd2);
		background: transparent;
		border-radius: 10px;
		padding: 18px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		cursor: pointer;
		text-align: left;
		color: var(--fg2);
	}
	.add-tile:hover {
		border-color: var(--blue);
	}
	.a-title {
		font-size: 14px;
		font-weight: 500;
	}
	.a-note {
		font-size: 12.5px;
		color: var(--fg3);
	}
	.add-form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		color: var(--fg3);
	}
	input,
	select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
	}
	.toggle {
		flex-direction: row;
		align-items: center;
		gap: 10px;
		font-size: 13px;
		color: var(--fg2);
	}
	.secured {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.secured legend {
		font-size: 12px;
		color: var(--fg3);
		padding-bottom: 4px;
	}
	.secured-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 200px;
		gap: 10px;
		align-items: center;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.l-tags {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid var(--bd2);
		border-radius: 999px;
		padding: 3px 5px 3px 10px;
		font-size: 12px;
		color: var(--fg2);
	}
	.tag-chip button {
		border: 0;
		background: none;
		color: var(--fg3);
		cursor: pointer;
		font-size: 11px;
		padding: 0 3px;
	}
</style>
