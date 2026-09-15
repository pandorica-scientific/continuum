<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Grants the household holds, valued at the latest close. Broker-neutral on
	// purpose: where the shares sit is not this card's business. Grants are
	// created and rescheduled on Salary; what happens here is what happens to
	// the shares — a settlement, a sale — and a close typed by hand when no
	// feed has one.
	import { enhance } from '$app/forms';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import type { Column } from '$lib/components/data-table';
	import type { Hue } from '$lib/ui/hue';
	import type { EquityGrantRow, EquityTrancheRow } from '$lib/invest/equity-rows';

	let { rows, unit }: { rows: EquityGrantRow[]; unit: string } = $props();
	let open = $state<string | null>(null);
	let settling = $state<string | null>(null);
	let selling = $state<string | null>(null);

	const COLUMNS: Column[] = $derived<Column[]>([
		{ key: 'grant', label: 'Grant', width: 'minmax(0, 1.6fr)' },
		{ key: 'vested', label: 'Vested', align: 'end', width: 'minmax(90px, auto)' },
		{ key: 'pending', label: 'Pending', align: 'end', width: 'minmax(90px, auto)', hideBelow: 760 },
		{ key: 'next', label: 'Next vest', width: 'minmax(140px, auto)', hideBelow: 900 },
		{ key: 'value', label: 'Vested value', align: 'end', width: 'minmax(120px, auto)' },
		{ key: 'base', label: `In ${unit}`, align: 'end', width: 'minmax(110px, auto)', hideBelow: 900 }
	]);

	const STATE_HUE: Record<EquityTrancheRow['state'], Hue> = {
		vested: 'purple',
		pending: 'grey',
		forfeited: 'red'
	};
</script>

<section class="card equity">
	<div class="eyebrow-row" style="padding-bottom: 8px;">
		<Eyebrow hue="--purple" icon="coins" label="Equity" />
		<span class="eyebrow-caption">restricted stock units · grants are added from Salary</span>
	</div>
	{#if rows.length}
		<DataTable
			columns={COLUMNS}
			groups={[{ key: 'all', open: true, rows }]}
			flat
			hue="--purple"
			label="Equity"
			rowKey={(r) => r.id}
		>
			{#snippet row(r, visible)}
				<button
					type="button"
					class="grant"
					aria-expanded={open === r.id}
					onclick={() => (open = open === r.id ? null : r.id)}
				>
					<span class="mono ticker">{r.ticker}</span>
					<span class="name">{r.label}{r.employer ? ` · ${r.employer}` : ''} · {r.person}</span>
				</button>
				<span class="mono r">{r.vestedUnits}<span class="muted"> / {r.grantedUnits}</span></span>
				{#if visible.has('pending')}<span class="mono r muted">{r.pendingUnits}</span>{/if}
				{#if visible.has('next')}<span class="mono small muted">{r.nextVest ?? '—'}</span>{/if}
				<span class="mono r">
					{#if r.vestedValue}{r.vestedValue}
						{r.currency}<span class="quiet">&nbsp;· {r.priceDay}</span>{:else}—{/if}
				</span>
				{#if visible.has('base')}<span class="mono r muted">{r.vestedBase ?? '—'}</span>{/if}
				{#if r.priceStale}
					<form method="POST" action="/investments?/setPrice" use:enhance class="wide price-prompt">
						<input type="hidden" name="ticker" value={r.ticker} />
						<input type="hidden" name="currency" value={r.currency} />
						<span class="quiet"
							>{r.priceDay ? `Last price ${r.priceDay}` : 'No price yet'} · type today's close</span
						>
						<input
							name="close"
							inputmode="decimal"
							placeholder="close in {r.currency}"
							aria-label="Close price in {r.currency}"
							required
						/>
						<button type="submit" class="btn">Save</button>
					</form>
				{/if}
				{#if open === r.id}
					<ul class="wide tranches">
						{#each r.tranches as t (t.id)}
							<li>
								<div class="tranche">
									<span class="mono">{t.vestsOn}</span>
									<span class="mono">{t.units} units</span>
									<Pill hue={STATE_HUE[t.state]}>{t.state}{t.onPayslip ? ' · on payslip' : ''}</Pill
									>
									{#if t.delivered !== null}
										<span class="muted">{t.delivered} delivered · {t.withheld} withheld</span>
									{/if}
									{#if Number(t.sold) > 0}<span class="muted">{t.sold} sold</span>{/if}
									{#if t.state === 'vested'}
										<span class="actions">
											<button
												type="button"
												class="btn"
												onclick={() => (settling = settling === t.id ? null : t.id)}
												>Record settlement</button
											>
											<button
												type="button"
												class="btn"
												onclick={() => (selling = selling === t.id ? null : t.id)}
												>Record sale</button
											>
										</span>
									{/if}
								</div>
								{#if settling === t.id}
									<form
										method="POST"
										action="/salary?/recordSettlement"
										use:enhance
										class="inline-form"
									>
										<input type="hidden" name="trancheId" value={t.id} />
										<input
											type="date"
											name="settledOn"
											value={t.vestsOn}
											aria-label="Settled on"
											required
										/>
										<input
											name="deliveredUnits"
											inputmode="decimal"
											placeholder="delivered"
											aria-label="Units delivered"
											required
										/>
										<input
											name="withheldUnits"
											inputmode="decimal"
											placeholder="withheld"
											aria-label="Units withheld for tax"
											value="0"
										/>
										<label class="check"
											><input type="checkbox" name="onPayslip" /> on payslip</label
										>
										<button type="submit" class="btn btn-primary">Save</button>
									</form>
								{/if}
								{#if selling === t.id}
									<form method="POST" action="/salary?/recordSale" use:enhance class="inline-form">
										<input type="hidden" name="trancheId" value={t.id} />
										<input
											name="soldUnits"
											inputmode="decimal"
											placeholder="units sold (held {t.held})"
											aria-label="Units sold"
											required
										/>
										<button type="submit" class="btn btn-primary">Save</button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			{/snippet}
		</DataTable>
	{:else}
		<p class="quiet">
			No equity grants yet — add one from Salary when an employer grants you shares.
		</p>
	{/if}
</section>

<style>
	.equity {
		margin-top: var(--space-6);
	}
	.grant {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		min-width: 0;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.grant:focus-visible {
		outline: 2px solid var(--purple);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}
	.ticker {
		font-size: var(--text-md);
	}
	.name {
		font-size: var(--text-xs);
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
	}
	.r,
	.small {
		font-size: var(--text-md);
	}
	.r {
		text-align: right;
	}
	.muted {
		color: var(--fg3);
	}
	/* Rows sit on the table's grid; the prompt and the tranche list span it. */
	.wide {
		grid-column: 1 / -1;
	}
	.price-prompt,
	.inline-form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}
	.price-prompt input,
	.inline-form input:not([type='checkbox']) {
		height: 36px;
		max-width: 180px;
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
	}
	.tranches {
		list-style: none;
		margin: var(--space-3) 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.tranche {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-5);
		font-size: var(--text-sm);
	}
	.actions {
		display: inline-flex;
		gap: var(--space-3);
		margin-left: auto;
	}
	.inline-form {
		margin-top: var(--space-3);
	}
</style>
