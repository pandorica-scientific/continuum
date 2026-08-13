<script lang="ts">
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import MetricTile from '$lib/components/MetricTile.svelte';
	import Pill from '$lib/components/Pill.svelte';

	let { data, form } = $props();

	let adding = $state(false);
	let regime = $state('fixed_period');
</script>

<ScreenHeader
	emoji="💳"
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
			note={`deductible: ${data.metrics.deductible}`}
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
						><option>CZK</option><option>EUR</option><option>PLN</option></select
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
				{#if data.properties.length}
					<label
						><span>Secured by</span>
						<select name="securedBy">
							<option value="">—</option>
							{#each data.properties as p (p.id)}
								<option value={p.id}>{p.name}</option>
							{/each}
						</select></label
					>
				{/if}
				<label><span>Started</span><input name="startDate" type="date" /></label>
				<label><span>Ends (contract)</span><input name="endDate" type="date" /></label>
			</div>
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
	.row {
		display: flex;
		gap: 8px;
	}
</style>
