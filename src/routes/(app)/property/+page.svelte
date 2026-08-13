<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import ImageSlot from '$lib/components/ImageSlot.svelte';

	let { data, form } = $props();

	let addingProperty = $state(false);
	let addingTenancy = $state(false);
	let addingBill = $state(false);

	const photoLabels = ['Living room', 'Kitchen', 'Building'];
</script>

<ScreenHeader
	emoji="🏢"
	title="Property"
	caption="Each flat with its value, mortgage, bills and tenancy."
/>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<section class="switcher">
	{#each data.tabs as tab (tab.id)}
		<button
			type="button"
			class="tab"
			class:active={tab.active}
			onclick={() => goto(`?p=${tab.id}`, { keepFocus: true, noScroll: true })}
		>
			<span>🏢</span><span>{tab.name}</span>
			<span class="mono tag">{tab.tag}</span>
		</button>
	{/each}
	<button type="button" class="tab add" onclick={() => (addingProperty = !addingProperty)}>
		➕ Add property
	</button>
</section>

{#if addingProperty}
	<form method="POST" action="?/addProperty" use:enhance class="card add-form">
		<div class="grid">
			<label><span>Name</span><input name="name" placeholder="Karlín, Praha 8" /></label>
			<label><span>Size line</span><input name="sizeLabel" placeholder="3+kk · 78 m²" /></label>
			<label
				><span>Kind</span>
				<select name="kind">
					<option value="lived">You live here</option>
					<option value="rented">Rented out</option>
				</select></label
			>
			<label
				><span>Currency</span>
				<select name="currency"
					>{#each data.currencies as c (c)}<option>{c}</option>{/each}</select
				></label
			>
			<label
				><span>Estimated value</span><input
					name="value"
					inputmode="decimal"
					placeholder="9 850 000"
				/></label
			>
			<label
				><span>Money in so far</span><input
					name="moneyIn"
					inputmode="decimal"
					placeholder="2 940 000"
				/></label
			>
			<label
				><span>Bought (year)</span><input
					name="boughtYear"
					inputmode="numeric"
					placeholder="2019"
				/></label
			>
		</div>
		<div class="row">
			<button type="submit" class="btn btn-primary">Add property</button>
			<button type="button" class="btn" onclick={() => (addingProperty = false)}>Cancel</button>
		</div>
	</form>
{/if}

{#if data.detail}
	<section class="section">
		<div class="eyebrow-row">
			<Eyebrow emoji="🏢" label="This flat" />
			<span class="eyebrow-caption">{data.detail.sizeLabel || data.detail.name}</span>
		</div>
		<div class="tiles">
			{#each data.detail.metrics as m (m.label)}
				<div class="tile">
					<span class="t-label">{m.label}</span>
					<span class="mono t-value" style:color={m.color}>{m.value}</span>
					<span class="t-note">{m.note}</span>
				</div>
			{/each}
		</div>
	</section>

	<section class="two-col">
		<div class="card stack">
			<div class="eyebrow-row">
				<Eyebrow emoji="📐" label="Floor plan" />
				<span class="eyebrow-caption">{data.detail.sizeLabel}</span>
			</div>
			<div class="plan">
				<ImageSlot
					propertyId={data.detail.id}
					slot="plan"
					image={data.detail.images.plan}
					placeholder="Drop the floor plan"
					fit="contain"
				/>
			</div>
			<div class="photos">
				{#each photoLabels as label, i (label)}
					<div class="photo">
						<ImageSlot
							propertyId={data.detail.id}
							slot={`photo${i}`}
							image={data.detail.images.photos[i]}
							placeholder={label}
						/>
					</div>
				{/each}
			</div>
		</div>

		<div class="stack" style="gap: 16px;">
			{#if data.detail.kind === 'rented'}
				{#if data.detail.lease}
					<div class="card stack">
						<div class="eyebrow-row">
							<Eyebrow emoji="🔑" label="Tenancy" />
							<Pill hue={data.detail.lease.hue}>{data.detail.lease.state}</Pill>
						</div>
						<div class="tenant">
							<span class="avatar">{data.detail.lease.tenantInitials}</span>
							<div class="t-names">
								<span class="t-name">{data.detail.lease.tenantName}</span>
								<span class="t-contact">{data.detail.lease.tenantContact}</span>
							</div>
						</div>
						<div class="facts">
							{#each data.detail.lease.facts as f (f.label)}
								<div class="fact">
									<span class="f-label">{f.label}</span>
									<span class="mono f-value">{f.value}</span>
								</div>
							{/each}
						</div>
						{#if data.detail.lease.renewalNotice}
							<span class="quiet">Renewal notice due by {data.detail.lease.renewalNotice}.</span>
						{/if}
					</div>
				{:else if addingTenancy}
					<form method="POST" action="?/addTenancy" use:enhance class="card add-form">
						<input type="hidden" name="propertyId" value={data.detail.id} />
						<div class="grid">
							<label
								><span>Tenant</span><input name="tenantName" placeholder="Martin Dvořák" /></label
							>
							<label
								><span>Contact</span><input
									name="tenantContact"
									placeholder="+420 … · email"
								/></label
							>
							<label
								><span>Rent / month</span><input
									name="rent"
									inputmode="decimal"
									placeholder="16 500"
								/></label
							>
							<label
								><span>Deposit held</span><input
									name="deposit"
									inputmode="decimal"
									placeholder="33 000"
								/></label
							>
							<label><span>Since</span><input name="startDate" type="date" /></label>
							<label><span>Lease ends</span><input name="endDate" type="date" /></label>
							<label
								><span>Renewal notice by</span><input name="renewalNoticeDate" type="date" /></label
							>
						</div>
						<div class="row">
							<button type="submit" class="btn btn-primary">Add tenancy</button>
							<button type="button" class="btn" onclick={() => (addingTenancy = false)}
								>Cancel</button
							>
						</div>
					</form>
				{:else}
					<button type="button" class="add-tile" onclick={() => (addingTenancy = true)}>
						<span class="a-title">➕ Add tenancy</span>
						<span class="a-note">Tenant, rent, deposit and the lease dates.</span>
					</button>
				{/if}
			{:else}
				<div class="card stack">
					<Eyebrow emoji="🏠" label="You live here" />
					<span class="quiet">
						Home Assistant is bound to this flat, so its energy and water readings become the bills
						you see below — no meter typing. The integration lands in Phase 4.
					</span>
				</div>
			{/if}

			<div class="card stack">
				<div class="eyebrow-row">
					<Eyebrow emoji="🧾" label="Monthly bills" />
					<span class="mono eyebrow-caption">{data.detail.billsTotal}</span>
				</div>
				{#each data.detail.bills as bill (bill.id)}
					<div class="bill">
						<span class="b-label">{bill.label}</span>
						<span class="mono">{bill.value}</span>
					</div>
				{:else}
					<span class="quiet">No bills on record yet.</span>
				{/each}
				{#if addingBill}
					<form method="POST" action="?/addBill" use:enhance class="bill-form">
						<input type="hidden" name="propertyId" value={data.detail.id} />
						<input name="label" placeholder="SVJ fee & repair fund" />
						<input name="amount" inputmode="decimal" placeholder="4 850" />
						<button type="submit" class="btn">Add</button>
					</form>
				{:else}
					<button
						type="button"
						class="btn"
						style="align-self: flex-start;"
						onclick={() => (addingBill = true)}
					>
						➕ Add bill
					</button>
				{/if}
			</div>

			{#if data.detail.mortgage}
				<div class="card stack">
					<div class="eyebrow-row">
						<Eyebrow emoji="🏦" label="Mortgage" />
						<span class="eyebrow-caption" style="color: var(--yellow);"
							>{data.detail.mortgage.fixation}</span
						>
					</div>
					<div class="track">
						<div class="fill" style:width="{data.detail.mortgage.paidPct}%"></div>
					</div>
					<span class="quiet">{data.detail.mortgage.paidNote}</span>
					<a href="/loans" class="btn" style="align-self: flex-start;"
						>Schedule &amp; repayments →</a
					>
				</div>
			{:else}
				<div class="card stack">
					<Eyebrow emoji="🏦" label="Mortgage" />
					<span class="quiet">
						Add the mortgage on the <a href="/loans">Loans screen</a> and link it to this flat to see
						equity and the repayment schedule here.
					</span>
				</div>
			{/if}
		</div>
	</section>
{:else}
	<section class="card">
		<span class="quiet">No properties yet — add the first one above.</span>
	</section>
{/if}

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.switcher {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 9px;
		border: 1px solid var(--bd);
		background: var(--card);
		color: var(--fg2);
		border-radius: 10px;
		padding: 10px 15px;
		font-size: 13.5px;
		cursor: pointer;
	}
	.tab:hover {
		border-color: var(--bd2);
	}
	.tab.active {
		background: var(--card3);
		color: var(--fg1);
		border-color: var(--bd2);
	}
	.tab .tag {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.tab.add {
		border-style: dashed;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 12px;
	}
	.tile {
		background: var(--card);
		border: 1px solid var(--bd);
		border-radius: 10px;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.t-label {
		font-size: 12px;
		color: var(--fg3);
	}
	.t-value {
		font-size: 18px;
		font-weight: 600;
	}
	.t-note {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.two-col {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}
	@media (max-width: 900px) {
		.two-col {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.plan {
		height: 300px;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid var(--bd);
	}
	.photos {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
	}
	.photo {
		height: 144px;
		border-radius: 8px;
		overflow: hidden;
		border: 1px solid var(--bd);
	}
	.tenant {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.avatar {
		width: 40px;
		height: 40px;
		border-radius: 40px;
		background: var(--card3);
		display: grid;
		place-items: center;
		font-size: 14px;
	}
	.t-names {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.t-name {
		font-size: 14px;
		font-weight: 500;
	}
	.t-contact {
		font-size: 12px;
		color: var(--fg3);
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
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
		font-size: 13.5px;
	}
	.bill {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		font-size: 13px;
	}
	.b-label {
		color: var(--fg2);
	}
	.bill-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 110px auto;
		gap: 8px;
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
		line-height: 1.55;
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
	.row {
		display: flex;
		gap: 8px;
	}
</style>
