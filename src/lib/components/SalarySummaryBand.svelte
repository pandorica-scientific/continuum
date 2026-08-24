<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// What the whole salary record adds up to, before any of it is broken down.
	//
	// Unlike TaxSummaryBand this one ANSWERS to the person filter beneath it.
	// "What has Robert earned" and "what has the household earned" are different
	// questions and both are worth asking, whereas a tax year's total is the same
	// figure whoever filed it. The filter keeps Tax's position so the two screens
	// still read the same way down the page.
	//
	// Gross leads every figure and net sits beneath it. This release exists
	// because the two were being confused for each other; a headline that did not
	// say which it was would be the same defect wearing a new coat.
	import { displayCurrency, formatMinor } from '$lib/money';
	import { lastBaseIncrease, type SalaryYear } from '$lib/salary';

	interface SerialisedSalaryYear {
		year: number;
		age: number | null;
		grossAvgMinor: string | null;
		netAvgMinor: string | null;
		grossTotalMinor: string;
		baseTotalMinor: string;
		bonusTotalMinor: string;
		netTotalMinor: string;
		grossMonths: number;
		netMonths: number;
		netComplete: boolean;
		deltaPct: number | null;
		baseDeltaPct: number | null;
	}

	let {
		years,
		currency,
		scope
	}: {
		years: SerialisedSalaryYear[];
		currency: string;
		/** 'household' when the filter says Both, 'person' when it names one. */
		scope: 'household' | 'person';
	} = $props();

	const symbol = $derived(displayCurrency(currency));

	// Back to bigint: the loader serialises minor units as strings because JSON
	// has no bigint, and money is never summed as a float.
	const rows = $derived(
		[...years]
			.map((y) => ({
				...y,
				gross: BigInt(y.grossTotalMinor),
				net: BigInt(y.netTotalMinor),
				base: BigInt(y.baseTotalMinor)
			}))
			.sort((a, b) => a.year - b.year)
	);

	const totalGross = $derived(rows.reduce((sum, r) => sum + r.gross, 0n));
	const totalNet = $derived(rows.reduce((sum, r) => sum + r.net, 0n));
	const grossMonths = $derived(rows.reduce((n, r) => n + r.grossMonths, 0));
	const netMonths = $derived(rows.reduce((n, r) => n + r.netMonths, 0));

	const latest = $derived(rows.at(-1) ?? null);

	// Over the months actually recorded, never over the years: a year with four
	// payslips is a partial year, and dividing its total by twelve reports a
	// monthly figure nobody was paid.
	const avgMonthGross = $derived(grossMonths === 0 ? null : totalGross / BigInt(grossMonths));
	const avgMonthNet = $derived(netMonths === 0 ? null : totalNet / BigInt(netMonths));
	const avgYearGross = $derived(rows.length === 0 ? null : totalGross / BigInt(rows.length));
	const avgYearNet = $derived(rows.length === 0 ? null : totalNet / BigInt(rows.length));

	const latestAvgGross = $derived(
		latest && latest.grossMonths > 0 ? latest.gross / BigInt(latest.grossMonths) : null
	);
	const latestAvgNet = $derived(
		latest && latest.netMonths > 0 ? latest.net / BigInt(latest.netMonths) : null
	);

	// A household has no single raise — two people get their own, in different
	// years, and averaging them describes nobody.
	const increase = $derived(
		scope === 'person'
			? lastBaseIncrease(
					years.map((y) => ({ year: y.year, baseDeltaPct: y.baseDeltaPct }) as SalaryYear)
				)
			: null
	);

	const money = (v: bigint | null) => (v === null ? '—' : formatMinor(v, currency));
</script>

{#if rows.length > 0}
	<section class="card band">
		<div class="figure">
			<span class="label">Earned since {rows[0].year}</span>
			<span class="mono value">
				{money(totalGross)}<span class="unit">{symbol}</span>
			</span>
			<span class="sub">gross · {money(totalNet)} net</span>
		</div>

		{#if scope === 'household'}
			<div class="figure">
				<span class="label">Average year</span>
				<span class="mono value">
					{money(avgYearGross)}<span class="unit">{symbol}</span>
				</span>
				<span class="sub"
					>gross · {money(avgYearNet)} net, over {rows.length}
					{rows.length === 1 ? 'year' : 'years'}</span
				>
			</div>

			<div class="figure">
				<span class="label">Last year · {latest?.year}</span>
				<span class="mono value">
					{money(latest?.gross ?? null)}<span class="unit">{symbol}</span>
				</span>
				<span class="sub">
					{#if latest && !latest.netComplete}⚠{/if}
					gross · {money(latest?.net ?? null)} net
				</span>
			</div>
		{:else}
			<div class="figure">
				<span class="label">Average month</span>
				<span class="mono value">
					{money(avgMonthGross)}<span class="unit">{symbol}</span>
				</span>
				<span class="sub">
					gross · {money(avgMonthNet)} net, over {grossMonths}
					{grossMonths === 1 ? 'month' : 'months'}
				</span>
			</div>

			<div class="figure">
				<span class="label">Last increase</span>
				<!-- Green only when there IS one. A green dash reads as a positive
				     figure at a glance, which is the opposite of what it says. -->
				<span class="mono value" class:rise={increase !== null}>
					{increase === null ? '—' : `+${increase.pct}%`}
				</span>
				<span class="sub">
					{#if increase === null}
						no increase recorded
					{:else}
						in {increase.year} · base pay, bonus excluded
					{/if}
				</span>
			</div>

			<div class="figure">
				<span class="label">Average month, {latest?.year}</span>
				<span class="mono value">
					{money(latestAvgGross)}<span class="unit">{symbol}</span>
				</span>
				<span class="sub">
					{#if latest && !latest.netComplete}⚠{/if}
					gross · {money(latestAvgNet)} net
				</span>
			</div>
		{/if}
	</section>
{/if}

<style>
	.band {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: var(--space-8);
		align-items: end;
		background: var(--teal-wash);
	}
	/* Spread across the row rather than bunched at its left edge.
	   `auto-fit` collapses the empty tracks, so three figures take three equal
	   thirds — and left-aligning all three left the last third looking empty.
	   First reads from the left edge, last to the right edge, middles centred. */
	.figure {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		align-items: center;
		text-align: center;
	}
	.figure:first-child {
		align-items: flex-start;
		text-align: left;
	}
	.figure:last-child {
		align-items: flex-end;
		text-align: right;
	}
	.label {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.value {
		font-size: var(--text-4xl);
		font-weight: 600;
		color: var(--fg1);
		line-height: 1.1;
		overflow-wrap: anywhere;
	}
	.rise {
		color: var(--green);
	}
	.unit {
		font-size: var(--text-md);
		font-weight: 400;
		color: var(--fg3);
		margin-left: 6px;
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
</style>
