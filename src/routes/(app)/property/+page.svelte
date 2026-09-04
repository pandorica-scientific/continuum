<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
	import IconTile from '$lib/components/IconTile.svelte';
	import { shouldCloseAfterAction } from '$lib/actions/result';
	import TagInput from '$lib/components/TagInput.svelte';
	import InfoHint from '$lib/components/InfoHint.svelte';
	import { goto } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import ImageSlot from '$lib/components/ImageSlot.svelte';
	import Lightbox from '$lib/components/Lightbox.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import FloorPlan from '$lib/components/FloorPlan.svelte';
	import FloorPlanEditor from '$lib/components/FloorPlanEditor.svelte';
	import DocumentsCard from '$lib/components/DocumentsCard.svelte';
	import FigureGrid from '$lib/components/FigureGrid.svelte';
	import { documentFileHref } from '$lib/ui/file-viewer';

	let { data, form } = $props();

	let addingProperty = $state(false);
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
	let editingPlan = $state(false);
	let addingTenancy = $state(false);
	// A lease with no agreed end. The date input is disabled rather than hidden so
	// the field it replaces stays where the eye expects it.
	let openEnded = $state(false);
	let addingBill = $state(false);

	/**
	 * The value line. Only drawn from two points up — one valuation is a dot, and
	 * a dot pretending to be a trend is worse than no chart.
	 */
	const valueChart = $derived.by(() => {
		const series = data.detail?.valueSeries ?? [];
		if (series.length < 2) return null;
		const values = series.map((v) => v.raw);
		const max = Math.max(...values);
		const min = Math.min(...values);
		// A flat line still needs a denominator.
		const span = max - min || Math.max(max, 1);
		const x = (i: number) => (i / (series.length - 1)) * 800;
		const y = (v: number) => 160 - ((v - min) / span) * 160;
		return {
			line: series.map((v, i) => `${x(i).toFixed(1)},${y(v.raw).toFixed(1)}`).join(' '),
			axis: [0, 0.5, 1].map((f) => ({
				top: `${f * 100}%`,
				label: Math.round((min + (1 - f) * span) / 1000).toLocaleString('en-GB') + 'k'
			}))
		};
	});
	let lightbox = $state<string | null>(null);
</script>

<ScreenHeader title="Property" caption="Each flat with its value, mortgage, bills and tenancy." />

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
			<IconTile hue="--purple" icon="buildings" size={28} />
			<span class="t-name">{tab.name}</span>
			<span class="mono tag">{tab.tag}</span>
		</button>
	{/each}
	<button type="button" class="tab add" onclick={() => (addingProperty = !addingProperty)}>
		<IconTile hue="--purple" icon="plus" size={28} />
		<span class="t-name">Add property</span>
	</button>
</section>

{#if addingProperty}
	<form
		method="POST"
		action="?/addProperty"
		use:enhance={closeOnSuccess(() => (addingProperty = false))}
		class="card add-form"
	>
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
			<Eyebrow hue="--purple" emoji="🏢" label="This flat" />
			<span class="eyebrow-caption">{data.detail.sizeLabel || data.detail.name}</span>
			<span class="p-tags">
				{#each data.detail.tags as t (t)}
					<form method="POST" action="?/tags" use:enhance class="tag-chip">
						<input type="hidden" name="id" value={data.detail.id} />
						<input type="hidden" name="removeTag" value={t} />
						<span>{t}</span>
						<button type="submit" aria-label="Remove tag {t}">✕</button>
					</form>
				{/each}
				<form method="POST" action="?/tags" use:enhance>
					<input type="hidden" name="id" value={data.detail.id} />
					<TagInput
						transactionId={data.detail.id}
						known={data.knownTags ?? []}
						placeholder="Add a tag…"
					/>
				</form>
				<!-- A bare box reading "tag…" beside no label explained nothing about
				     what a tag is or why this flat would want one. -->
				<InfoHint label="What a tag is for">
					A tag groups spending that belongs to one project, across whatever categories it happens
					to touch — a bathroom renovation is materials, a tradesman and a permit fee, filed under
					three different categories.
					<br /><br />
					Tag them all “bathroom” and the Tags screen shows what the project has cost so far. The same
					tag works on transactions, documents and loans, so everything about one project can be found
					together.
				</InfoHint>
			</span>
		</div>
		<FigureGrid figures={data.detail.metrics} recordId={data.detail.id} action="?/setFigure" />
	</section>

	<section class="two-col">
		<div class="card stack">
			<div class="eyebrow-row">
				<Eyebrow hue="--purple" emoji="📐" label="Floor plan" />
				<button type="button" class="btn plan-edit" onclick={() => (editingPlan = !editingPlan)}>
					{editingPlan
						? 'Close editor'
						: data.detail.images.drawing
							? '✏️ Edit plan'
							: '✏️ Draw plan'}
				</button>
			</div>
			{#if editingPlan}
				{#key data.detail.id}
					<FloorPlanEditor
						propertyId={data.detail.id}
						initial={data.detail.images.drawing ?? null}
						onclose={() => (editingPlan = false)}
					/>
				{/key}
			{:else if data.detail.images.drawing}
				<div class="plan drawn">
					<FloorPlan drawing={data.detail.images.drawing} />
				</div>
			{:else}
				<div class="plan">
					<ImageSlot
						propertyId={data.detail.id}
						slot="plan"
						image={data.detail.images.plan}
						placeholder="Drop the floor plan — or draw one"
						fit="contain"
						onview={(img) => (lightbox = img)}
					/>
				</div>
			{/if}
			<div class="photos">
				{#each data.detail.images.photos as photo, i (photo)}
					<div class="photo">
						<ImageSlot
							propertyId={data.detail.id}
							slot={`photo${i}`}
							image={photo}
							placeholder={`Photo ${i + 1}`}
							onview={(img) => (lightbox = img)}
						/>
					</div>
				{/each}
				<div class="photo">
					<ImageSlot
						propertyId={data.detail.id}
						slot={`photo${data.detail.images.photos.length}`}
						image={undefined}
						placeholder="➕ Add photo"
					/>
				</div>
			</div>
		</div>

		<div class="stack" style="gap: 16px;">
			{#if data.detail.kind === 'rented'}
				{#if data.detail.lease}
					<div class="card stack">
						<div class="eyebrow-row">
							<Eyebrow hue="--purple" emoji="🔑" label="Tenancy" />
							<Pill hue={data.detail.lease.hue}>{data.detail.lease.state}</Pill>
						</div>
						<div class="tenant">
							<span class="avatar">{data.detail.lease.tenantInitials}</span>
							<div class="t-names">
								<span class="t-name">{data.detail.lease.tenantName}</span>
								{#if data.detail.lease.tenantContacts.length}
									{#each data.detail.lease.tenantContacts as c (c.id)}
										<span class="t-contact">
											<a href="/contacts?q={encodeURIComponent(c.name)}">{c.name}</a>
											{#if c.phone}<a class="mono" href="tel:{c.phone}">{c.phone}</a>{/if}
											{#if c.email}<a href="mailto:{c.email}">{c.email}</a>{/if}
										</span>
									{/each}
								{:else}
									<a class="t-contact" href="/contacts">Add a contact</a>
								{/if}
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
					<DocumentsCard
						heading="Tenancy documents"
						documents={data.detail.lease.documents}
						target={{
							id: data.detail.lease.id,
							kind: 'tenancy',
							label: `${data.detail.name} · ${data.detail.lease.tenantName}`
						}}
						emptyText="Nothing filed about this tenancy yet — the signed lease belongs here."
						addHref={data.detail.lease.addDocumentHref}
						attach={{ action: 'attachDocument', candidates: data.detail.lease.documentCandidates }}
						detachAction="detachDocument"
						isAdmin={data.isAdmin}
					/>
				{:else if addingTenancy}
					<form method="POST" action="?/addTenancy" use:enhance class="card add-form">
						<input type="hidden" name="propertyId" value={data.detail.id} />
						<div class="grid">
							<label>
								<span>Tenant</span>
								<!-- Suggests who is already in the address book, so the same person
								     is not entered twice under two spellings. Adding a tenant files
								     them in Contacts, reusing their record when the name matches. -->
								<input name="tenantName" placeholder="Martin Dvořák" list="tenant-contacts" />
								<datalist id="tenant-contacts">
									{#each data.contactNames as name, i (i)}<option value={name}></option>{/each}
								</datalist>
							</label>
							<!-- How to reach the tenant is a contact record now, not a string on
						     the tenancy: it is attached from the Contacts screen once the
						     tenancy exists, so a tenant with two numbers and an agent is
						     representable. -->
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
							<label><span>Since</span><input name="startsOn" type="date" /></label>
							<label>
								<span>Lease ends</span>
								<input
									name="endsOn"
									type="date"
									disabled={openEnded}
									value={openEnded ? '' : undefined}
								/>
							</label>
							<label class="t-check">
								<input type="checkbox" bind:checked={openEnded} />
								<!-- A lease can run until somebody ends it. Requiring a date meant
								     inventing one, and an invented end date drives the renewal
								     reminder and the occupancy figures. -->
								<span>No end date — runs until ended</span>
							</label>
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
					<Eyebrow hue="--purple" emoji="🏠" label="You live here" />
					<span class="quiet">
						Home Assistant is bound to this flat, so its energy and water readings become the bills
						you see below — no meter typing. The integration lands in Phase 4.
					</span>
				</div>
			{/if}

			<div class="card stack">
				<div class="eyebrow-row">
					<Eyebrow hue="--purple" emoji="🧾" label="Monthly bills" />
					<span class="mono eyebrow-caption">{data.detail.billsTotal}</span>
				</div>
				{#each data.detail.bills as bill (bill.id)}
					<div class="bill">
						<span class="b-label">
							{bill.label}
							{#if bill.documentId}
								<a
									href={documentFileHref(bill.documentId)}
									target="_blank"
									rel="noopener"
									class="b-file"
									data-file-name={bill.label}
									aria-label="Open the bill for {bill.label}">📎</a
								>
							{/if}
							<form method="POST" action="?/setBillSource" use:enhance class="b-meter">
								<input type="hidden" name="billId" value={bill.id} />
								<input type="hidden" name="fromMeter" value={bill.fromMeter ? 'false' : 'true'} />
								<button
									type="submit"
									class="b-meter-btn"
									class:on={bill.fromMeter}
									title={bill.fromMeter
										? 'Read from the meter — click to go back to a fixed amount'
										: 'Read this bill from the smart meter instead'}
								>
									{bill.fromMeter ? '📟 from meter' : '📟'}
								</button>
							</form>
						</span>
						<span class="mono">{bill.value}</span>
					</div>
				{:else}
					<span class="quiet">No bills on record yet.</span>
				{/each}
				{#if addingBill}
					<form
						method="POST"
						action="?/addBill"
						use:enhance
						enctype="multipart/form-data"
						class="bill-form"
					>
						<input type="hidden" name="propertyId" value={data.detail.id} />
						<input name="label" placeholder="SVJ fee & repair fund" />
						<input name="amount" inputmode="decimal" placeholder="4 850" />
						<button type="submit" class="btn">Add</button>
						<div class="bill-file">
							<span>Bill file (optional) — it is filed in Documents about this flat</span>
							<UploadDropzone
								name="file"
								accept="application/pdf,image/*"
								idleText="Drop a bill here, or click to browse"
								description="PDF, PNG or JPEG"
							/>
						</div>
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
						<Eyebrow hue="--purple" emoji="🏦" label="Mortgage" />
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
					<Eyebrow hue="--purple" emoji="🏦" label="Mortgage" />
					<span class="quiet">
						Add the mortgage on the <a href="/loans">Loans screen</a> and link it to this flat to see
						equity and the repayment schedule here.
					</span>
				</div>
			{/if}

			<DocumentsCard
				documents={data.detail.documents}
				target={{ id: data.detail.id, kind: 'property', label: data.detail.name }}
				emptyText="Nothing filed about this flat yet — the deed or an insurance policy belongs here."
				addHref={data.detail.addDocumentHref}
				addLabel="Add a document about this flat"
				attach={{ action: 'attachDocument', candidates: data.detail.documentCandidates }}
				detachAction="detachDocument"
				isAdmin={data.isAdmin}
			/>
		</div>
	</section>
	<section class="card stack">
		<div class="eyebrow-row">
			<Eyebrow hue="--purple" emoji="📈" label="What it has been worth" />
			<span class="eyebrow-caption">
				{data.detail.valueSeries.length > 1
					? `${data.detail.valueSeries.length} valuations`
					: 'add a second valuation to see the line'}
			</span>
		</div>

		{#if valueChart}
			<div class="vchart">
				{#each valueChart.axis as a (a.top)}
					<span class="vaxis mono" style:top={a.top}>{a.label}</span>
				{/each}
				<svg viewBox="0 0 800 160" preserveAspectRatio="none">
					{#each [0, 80, 160] as gy (gy)}
						<line x1="0" y1={gy} x2="800" y2={gy} stroke="var(--bd)" stroke-width="1" />
					{/each}
					<polyline
						points={valueChart.line}
						fill="none"
						stroke="var(--purple)"
						stroke-width="2.5"
						stroke-linejoin="round"
						vector-effect="non-scaling-stroke"
					/>
				</svg>
			</div>
			<div class="vyears mono">
				<span>{data.detail.valueSeries[0].on}</span>
				<span>{data.detail.valueSeries[data.detail.valueSeries.length - 1].on}</span>
			</div>
		{/if}

		<ul class="vlist">
			{#each [...data.detail.valueSeries].reverse() as v (v.on)}
				<li>
					<span class="mono">{v.on}</span>
					<span class="vsource">{v.source}</span>
					<span class="mono vvalue">{v.value}</span>
				</li>
			{:else}
				<li class="quiet">No valuations yet — the first one starts the line.</li>
			{/each}
		</ul>

		<form method="POST" action="?/addValuation" use:enhance class="vform">
			<input type="hidden" name="propertyId" value={data.detail.id} />
			<input type="hidden" name="currency" value={data.detail.currency} />
			<label class="field"><span>On</span><input name="valuedOn" type="date" required /></label>
			<label class="field"><span>Worth</span><input name="value" inputmode="decimal" /></label>
			<label class="field">
				<span>From</span>
				<select name="source">
					<option value="estimate">An estimate</option>
					<option value="appraisal">An appraisal</option>
					<option value="index">A price index</option>
					<option value="purchase">What was paid</option>
				</select>
			</label>
			<button type="submit" class="btn btn-primary">Add</button>
		</form>
		<!-- A past date leaves today's figure alone, which is what makes entering
		     the history of a flat owned for years safe. -->
		<span class="quiet">
			Dating one in the past adds to the history without changing what the flat is worth today.
		</span>
	</section>

	<section class="card stack">
		<Eyebrow hue="--purple" emoji="🧾" label="What it cost to buy" />
		<!-- Money in is the household's OWN cash: the deposit plus the costs of
		     buying. The price itself is mostly the bank's, and the part that becomes
		     theirs arrives as the mortgage is repaid — which the loan already
		     records. Counting the price here would double it. -->
		<form method="POST" action="?/setOpening" use:enhance class="vform">
			<input type="hidden" name="propertyId" value={data.detail.id} />
			<input type="hidden" name="currency" value={data.detail.currency} />
			<label class="field">
				<span>Bought on</span>
				<input name="purchasedOn" type="date" value={data.detail.opening?.purchasedOn ?? ''} />
			</label>
			<label class="field">
				<span>Price</span>
				<input name="price" inputmode="decimal" value={data.detail.opening?.price ?? ''} />
			</label>
			<label class="field">
				<span>Fees &amp; tax</span>
				<input name="costs" inputmode="decimal" value={data.detail.opening?.costs ?? ''} />
			</label>
			<label class="field">
				<span>Deposit</span>
				<input name="deposit" inputmode="decimal" value={data.detail.opening?.deposit ?? ''} />
			</label>
			<button type="submit" class="btn btn-primary">Save</button>
		</form>
		<span class="quiet">
			Money in becomes the deposit plus the fees — your own cash. The rest of the price is the
			bank's, and becomes yours as the mortgage is repaid.
		</span>
	</section>
{:else}
	<section class="card">
		<span class="quiet">No properties yet — add the first one above.</span>
	</section>
{/if}

{#if lightbox}
	<Lightbox image={lightbox} alt="Property photo" onclose={() => (lightbox = null)} />
{/if}

<style>
	.vchart {
		position: relative;
		padding-left: 52px;
	}
	.vaxis {
		position: absolute;
		left: 0;
		width: 44px;
		text-align: right;
		transform: translateY(-50%);
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.vyears {
		display: flex;
		justify-content: space-between;
		margin-left: 52px;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.vlist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		font-size: var(--text-sm);
	}
	.vlist li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: var(--space-6);
		align-items: baseline;
	}
	.vsource {
		color: var(--fg3);
	}
	.vvalue {
		color: var(--fg1);
	}
	.vform {
		display: flex;
		align-items: flex-end;
		gap: var(--space-6);
		flex-wrap: wrap;
	}

	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.switcher {
		display: flex;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.tab {
		display: flex;
		align-items: center;
		gap: 9px;
		border: 1px solid var(--bd);
		background: var(--surface);
		color: var(--fg2);
		border-radius: var(--radius-card);
		padding: var(--space-4) var(--space-6);
		font-family: inherit;
		font-size: var(--text-md);
		cursor: pointer;
		transition:
			background-color var(--dur) var(--ease),
			border-color var(--dur) var(--ease);
	}
	.tab:hover {
		border-color: var(--bd2);
		background: var(--surface-2);
	}
	/* The area's hue, not a grey fill: this row is the screen's subject, and on
	   a page of purple tiles a grey selection read as disabled. */
	.tab.active {
		background: color-mix(in srgb, var(--purple) 12%, transparent);
		color: var(--fg1);
		border-color: color-mix(in srgb, var(--purple) 45%, transparent);
	}
	.t-name {
		font-weight: 500;
	}
	.tab .tag {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.tab.add {
		border-style: dashed;
		border-color: color-mix(in srgb, var(--purple) 40%, transparent);
		color: var(--fg3);
	}
	.two-col {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
		gap: var(--space-8);
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
		gap: var(--space-7);
	}
	.plan {
		height: 300px;
		border-radius: var(--radius-lg);
		overflow: hidden;
		border: 1px solid var(--bd);
	}
	.plan.drawn {
		background: var(--card);
		padding: 8px;
	}
	.plan-edit {
		min-height: auto;
		padding: 5px 11px;
		font-size: var(--text-sm);
	}
	.photos {
		display: flex;
		gap: var(--space-5);
		overflow-x: auto;
		padding-bottom: 4px;
	}
	.photo {
		flex: 0 0 200px;
		height: 144px;
		border-radius: var(--radius-md);
		overflow: hidden;
		border: 1px solid var(--bd);
	}
	.tenant {
		display: flex;
		align-items: center;
		gap: var(--space-6);
	}
	.avatar {
		width: 40px;
		height: 40px;
		border-radius: 40px;
		background: var(--card3);
		display: grid;
		place-items: center;
		font-size: var(--text-lg);
	}
	.t-names {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.t-name {
		font-size: var(--text-lg);
		font-weight: 500;
	}
	.t-contact {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
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
		font-size: var(--text-md);
	}
	.bill {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-6);
		font-size: var(--text-md);
	}
	.b-label {
		color: var(--fg2);
	}
	.bill-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 110px auto;
		gap: var(--space-4);
	}
	.b-file {
		text-decoration: none;
		font-size: var(--text-sm);
		margin-left: 4px;
	}
	.b-meter {
		display: inline;
	}
	/* Sits inline inside a sentence, so it takes its height from the line it is
	   part of rather than the form-control floor. */
	.b-meter-btn {
		min-height: auto;
		margin-left: 6px;
		padding: 1px 5px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: none;
		color: var(--fg3);
		font-size: var(--text-xs);
		cursor: pointer;
		opacity: 0.45;
	}
	.b-meter-btn:hover,
	.b-meter-btn:focus-visible {
		opacity: 1;
		border-color: var(--bd2);
	}
	.b-meter-btn.on {
		opacity: 1;
		color: var(--teal);
		border-color: var(--bd2);
	}
	.bill-file {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.quiet {
		line-height: 1.55;
	}
	.track {
		height: 8px;
		background: var(--card3);
		border-radius: var(--radius-xs);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: var(--green);
		border-radius: var(--radius-xs);
	}
	.add-tile {
		border: 1.5px dashed var(--bd2);
		background: transparent;
		border-radius: var(--radius-lg);
		padding: 18px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		cursor: pointer;
		text-align: left;
		color: var(--fg2);
	}
	.add-tile:hover {
		border-color: var(--blue);
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
	/* A checkbox beside its own words, rather than under a label like the date
	   and amount fields above it. */
	.t-check {
		flex-direction: row;
		align-items: center;
		gap: var(--space-4);
		align-self: end;
		padding-bottom: 8px;
	}
	.t-check input {
		width: auto;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.row {
		display: flex;
		gap: var(--space-4);
	}
	.p-tags {
		display: inline-flex;
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
