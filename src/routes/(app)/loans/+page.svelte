<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
	import { shouldCloseAfterAction } from '$lib/actions/result';
	import TagInput from '$lib/components/TagInput.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import SummaryBand from '$lib/components/SummaryBand.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import IconTile from '$lib/components/IconTile.svelte';
	import LoanSchedule from '$lib/charts/LoanSchedule.svelte';
	import RepayDialog from '$lib/components/RepayDialog.svelte';
	import RefixDialog from '$lib/components/RefixDialog.svelte';
	import DocumentsCard from '$lib/components/DocumentsCard.svelte';
	import { ENUMS } from '$lib/enums';
	import { DAY_COUNTS, DAY_COUNT_LABELS } from '$lib/loans';

	let { data, form } = $props();

	let adding = $state(false);
	/** Close on success, stay open on a refusal so what was typed is still there
	 *  to correct. Leaving it open on success is what made the wizard for the
	 *  next one appear the moment one was added. */
	const closeOnSuccess =
		(close: () => void) =>
		() =>
		async ({
			update,
			result
		}: {
			update: () => Promise<void>;
			result: import('@sveltejs/kit').ActionResult;
		}) => {
			await update();
			if (shouldCloseAfterAction(result.type)) close();
		};
	/** The rate regimes, named once and used by both the add and the edit form —
	 *  they were spelled out inline, so the two could disagree. */
	const REGIMES = [
		{ value: 'fixed_period', label: 'Fixed until a date, then re-fixed' },
		{ value: 'fixed_term', label: 'Fixed for the whole term' },
		{ value: 'floating', label: 'Floating' }
	] as const;

	let regime = $state('fixed_period');
	let open = $state<string | null>(null);
	let repayFor = $state<string | null>(null);
	let refixFor = $state<string | null>(null);
	let editFor = $state<string | null>(null);

	// From the one list the CHECK constraint is also built from, so the add form
	// and the edit form cannot drift apart from each other or from the database.
	const LOAN_KINDS = ENUMS['loan.kind'];
	const kindLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);
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
		<Eyebrow hue="--purple" icon="card" label="What you owe" />
		<span class="eyebrow-caption">
			{data.count === 0
				? 'no loans on record yet'
				: `${data.count} loan${data.count === 1 ? '' : 's'}`}
		</span>
	</div>
	<SummaryBand
		tiles={[
			{
				label: 'Total owed',
				value: data.metrics.totalOwed,
				unit: data.unit,
				color: 'var(--red)',
				wash: 'red'
			},
			{
				label: 'Monthly payments',
				value: data.metrics.monthlyPayments,
				unit: data.unit,
				wash: 'purple'
			},
			{
				label: 'Interest this year',
				value: data.metrics.interestThisYear,
				unit: data.unit,
				color: 'var(--orange)',
				note: data.metrics.interestNote,
				wash: 'orange'
			},
			{
				label: 'Debt-free',
				value: data.metrics.debtFree ? String(data.metrics.debtFree) : '—',
				note: 'at current payments',
				wash: 'green'
			}
		]}
	/>
</section>

<section class="section" style="gap: 12px;">
	{#each data.loans as l (l.id)}
		<!-- What the Overview's fixation card links to. Without an id per loan the
		     briefing could only offer the top of the screen, and a household with
		     four loans had to find the right one again. -->
		<div class="card loan" id="loan-{l.id}">
			<div class="head">
				<IconTile hue="--purple" icon="card" size={44} />
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
				<span class="note"
					>{l.paidNote}{l.monthInterest ? ` · ${l.monthInterest} interest this month` : ''}</span
				>
				<div class="track"><div class="fill" style:width="{l.paidPct}%"></div></div>
			</div>

			{#if l.band.length > 0}
				<!-- The rate a mortgage is fixed at is the one fact that decides what it
				     costs. A list of periods states that; a band shows it — above all
				     how much of the term runs past the last date anybody has agreed a
				     rate for, which on a 2049 mortgage fixed to 2028 is most of it. -->
				<div class="fixation">
					<div class="fix-caption">
						<span>Fixation · <span class="fix-now">{l.pill.label}</span></span>
						{#if l.bandRange}<span>{l.bandRange}</span>{/if}
					</div>
					<div class="band">
						{#each l.band as seg, i (i)}
							<span class="seg {seg.kind}" style:width="{seg.widthPct}%" title={seg.label}
								>{seg.label}</span
							>
						{/each}
					</div>
				</div>
			{/if}
			<button
				type="button"
				class="detail-toggle"
				onclick={() => (open = open === l.id ? null : l.id)}
			>
				{open === l.id ? 'Hide schedule & changes ▴' : 'Schedule & changes ▾'}
			</button>
			{#if open === l.id}
				<div class="detail">
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
					<!-- Nested inside `.card loan`, so `bare` drops the card-in-card border
			     and padding this component would otherwise add — the loan's own
			     card already supplies both, and the flex gap keeps the spacing. -->
					<DocumentsCard
						bare
						documents={l.documents}
						target={{ id: l.id, kind: 'loan', label: l.name }}
						emptyText="Nothing filed about this loan yet — the agreement and each re-fix letter belong here."
						addHref={l.addDocumentHref}
						attach={{ action: 'attachDocument', candidates: l.documentCandidates }}
						detachAction="detachDocument"
						isAdmin={data.isAdmin}
					/>

					{#if l.chart.length}
						<div class="eyebrow-row">
							<Eyebrow hue="--purple" icon="chart" label="Interest vs principal" />
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
						<button
							type="button"
							class="btn"
							onclick={() => (editFor = editFor === l.id ? null : l.id)}
						>
							✏️ Edit details…
						</button>
						<span class="mini-note">both preview their effect on the chart before saving</span>
					</div>

					{#if editFor === l.id}
						<!-- Description and security only. Rate, payment and balance are
						     changed through the two controls above, which understand the
						     history they rewrite; nothing here can touch a fixation period. -->
						<form method="POST" action="?/editLoan" use:enhance class="edit-form">
							<input type="hidden" name="id" value={l.id} />
							<div class="grid">
								<label><span>Name</span><input name="name" value={l.edit.name} /></label>
								<label><span>Lender</span><input name="lender" value={l.edit.lender} /></label>
								<label>
									<span>Kind</span>
									<select name="kind">
										{#each LOAN_KINDS as kind (kind)}
											<option value={kind} selected={l.edit.kind === kind}>{kindLabel(kind)}</option
											>
										{/each}
									</select>
								</label>
								<label>
									<span>Payment day</span>
									<input name="paymentDay" inputmode="numeric" value={l.edit.paymentDay ?? ''} />
								</label>
								<!-- How the loan works. Changing one of these re-derives the
								     schedule from the periods already recorded; none of them can
								     rewrite or remove a period, which is what keeps them safe to
								     put beside a name and a lender. -->
								<label>
									<span>Rate regime</span>
									<select name="regime">
										{#each REGIMES as option (option.value)}
											<option value={option.value} selected={l.edit.regime === option.value}>
												{option.label}
											</option>
										{/each}
									</select>
								</label>
								<label>
									<span>Interest accrual</span>
									<select name="accrualStyle">
										<option value="payment" selected={l.edit.accrualStyle === 'payment'}>
											On the payment date
										</option>
										<option value="calendar" selected={l.edit.accrualStyle === 'calendar'}>
											Over the calendar month
										</option>
									</select>
								</label>
								<label>
									<span>Day count</span>
									<select name="dayCount">
										{#each DAY_COUNTS as count (count)}
											<option value={count} selected={l.edit.dayCount === count}>
												{DAY_COUNT_LABELS[count]}
											</option>
										{/each}
									</select>
								</label>
								<label class="toggle">
									<input
										type="checkbox"
										name="interestDeductible"
										checked={l.edit.interestDeductible}
									/>
									<span>Interest reduces taxable income</span>
								</label>
								<label>
									<span>Ends</span>
									<input name="endsOn" type="date" value={l.edit.endsOn ?? ''} />
								</label>
							</div>
							<fieldset class="secured">
								<legend>Secured by</legend>
								{#each data.properties as p (p.id)}
									{@const link = l.edit.secured.find((s) => s.propertyId === p.id)}
									<div class="sec-row">
										<label class="sec-check">
											<input type="checkbox" name={`secured_${p.id}`} checked={!!link} />
											<span>{p.name}</span>
										</label>
										<input
											name={`share_${p.id}`}
											inputmode="decimal"
											placeholder="share % (blank = by value)"
											value={link?.sharePct ?? ''}
										/>
									</div>
								{/each}
							</fieldset>
							<div class="row">
								<button type="submit" class="btn btn-primary">Save changes</button>
								<button type="button" class="btn" onclick={() => (editFor = null)}>Cancel</button>
							</div>
						</form>
					{/if}
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
		<form
			method="POST"
			action="?/addLoan"
			use:enhance={closeOnSuccess(() => (adding = false))}
			class="card add-form"
		>
			<div class="grid">
				<label><span>Name</span><input name="name" placeholder="Mortgage · Karlín" /></label>
				<label><span>Lender</span><input name="lender" placeholder="Česká spořitelna" /></label>
				<label
					><span>Kind</span>
					<select name="kind">
						{#each LOAN_KINDS as kind (kind)}
							<option value={kind}>{kindLabel(kind)}</option>
						{/each}
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
						{#each REGIMES as option (option.value)}
							<option value={option.value}>{option.label}</option>
						{/each}
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
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.loan {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		/* Arriving at #loan-… puts the card's top edge against the viewport's,
		   which reads as the card being cut off. */
		scroll-margin-top: var(--space-8);
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-7);
		flex-wrap: wrap;
	}
	.names {
		flex: 1;
	}
	.names {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.name {
		font-size: var(--text-xl);
		font-weight: 600;
	}
	.sub {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
		gap: var(--space-6);
	}
	.fact {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.f-label {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.f-value {
		font-size: var(--text-lg);
	}
	.progress {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.track {
		height: 10px;
		background: var(--card3);
		border-radius: 5px;
		overflow: hidden;
	}
	/* Green into teal: repaid runs from "money you handed over" to the colour
	   the app uses for what has been put away, which is what a repayment is. */
	.fill {
		height: 100%;
		background: linear-gradient(
			90deg,
			var(--green),
			color-mix(in srgb, var(--green) 70%, var(--teal))
		);
		border-radius: 5px;
	}

	.fixation {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.fix-caption {
		display: flex;
		justify-content: space-between;
		gap: var(--space-5);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.fix-now {
		color: var(--fg1);
	}
	.band {
		display: flex;
		gap: var(--space-1);
		height: 26px;
		border-radius: var(--radius-md);
		overflow: hidden;
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
	}
	.seg {
		display: grid;
		place-items: center;
		padding: 0 var(--space-3);
		overflow: hidden;
	}
	/* Paid, and behind you. */
	.seg.past {
		background: color-mix(in srgb, var(--fg3) 30%, transparent);
		color: var(--fg2);
	}
	.seg.current {
		background: color-mix(in srgb, var(--teal) 55%, transparent);
		color: var(--fg1);
	}
	/* Hatched, because nothing is known about it: a flat fill would read as a
	   third rate somebody had agreed. */
	.seg.unknown {
		background: repeating-linear-gradient(
			45deg,
			color-mix(in srgb, var(--purple) 22%, transparent) 0 6px,
			transparent 6px 12px
		);
		color: var(--fg3);
	}
	.note {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.detail-toggle {
		align-self: flex-start;
		border: 0;
		background: transparent;
		color: var(--blue);
		font-size: var(--text-sm);
		cursor: pointer;
		padding: 0;
	}
	.detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		border-top: 1px solid var(--bd);
		padding-top: 14px;
	}
	.edit-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		padding-top: 12px;
		border-top: 1px solid var(--bd);
	}
	.edit-form .sec-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-4);
		align-items: center;
	}
	.edit-form .sec-check {
		flex-direction: row;
		align-items: center;
		gap: var(--space-4);
	}
	.edit-form .secured {
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.actions-row {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.mini-title {
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--fg1);
	}
	.mini-note {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.events {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.event {
		display: grid;
		grid-template-columns: 86px minmax(0, 1fr) auto;
		gap: var(--space-6);
		align-items: baseline;
		padding: 7px 0;
		border-bottom: 1px solid var(--bd);
		font-size: var(--text-md);
	}
	.e-date {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.e-label {
		color: var(--fg2);
	}
	.e-amount {
		font-size: var(--text-sm);
	}
	/* Dashed and purple: the vocabulary the Overview tray and the Add-a-shelf
	   row use for "a place a new thing goes", in this area's own hue. */
	.add-tile {
		border: 1.5px dashed color-mix(in srgb, var(--purple) 40%, transparent);
		background: color-mix(in srgb, var(--purple) 5%, transparent);
		border-radius: var(--radius-card);
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		cursor: pointer;
		text-align: left;
		color: var(--fg2);
	}
	.add-tile:hover {
		border-color: var(--purple);
	}
	.a-title {
		font-size: var(--text-lg);
		font-weight: 500;
	}
	.a-note {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.add-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-6);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.toggle {
		flex-direction: row;
		align-items: center;
		gap: var(--space-5);
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.secured {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.secured legend {
		font-size: var(--text-sm);
		color: var(--fg3);
		padding-bottom: 4px;
	}
	.secured-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 200px;
		gap: var(--space-5);
		align-items: center;
	}
	.row {
		display: flex;
		gap: var(--space-4);
	}
	.l-tags {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		padding: 3px 5px 3px 10px;
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.tag-chip button {
		border: 0;
		background: none;
		color: var(--fg3);
		cursor: pointer;
		font-size: var(--text-xs);
		padding: 0 3px;
	}
</style>
