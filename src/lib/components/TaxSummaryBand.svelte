<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// What the whole record adds up to, before any of it is broken down.
	//
	// Household-wide always. The person filter sits BELOW this band and governs
	// the chart and the matrix; a band that answered to a control beneath it
	// would read backwards, and "overall" is the one figure that should not move
	// when you narrow the view.
	import { blendedRatePct, type YearRow } from '$lib/tax';
	import { displayCurrency, formatMinor } from '$lib/money';

	interface SerialisedYear {
		year: number;
		grossMinor: string;
		taxMinor: string;
		ratePct: number | null;
		byCountry: { country: string }[];
	}

	let { years, currency }: { years: SerialisedYear[]; currency: string } = $props();

	// Back to bigint: the loader serialises minor units as strings because JSON
	// has no bigint, and money is never summed as a float.
	const rows = $derived<YearRow[]>(
		years.map((y) => ({
			year: y.year,
			grossMinor: BigInt(y.grossMinor),
			taxMinor: BigInt(y.taxMinor),
			ratePct: y.ratePct,
			byCountry: []
		}))
	);

	const gross = $derived(rows.reduce((sum, r) => sum + r.grossMinor, 0n));
	const tax = $derived(rows.reduce((sum, r) => sum + r.taxMinor, 0n));
	const blended = $derived(blendedRatePct(rows));
	const jurisdictions = $derived(
		new Set(years.flatMap((y) => y.byCountry.map((c) => c.country))).size
	);

	const latest = $derived(years.at(-1) ?? null);
	const previous = $derived(years.length > 1 ? years.at(-2)! : null);
	const delta = $derived(
		latest && previous ? BigInt(latest.grossMinor) - BigInt(previous.grossMinor) : null
	);

	const symbol = $derived(displayCurrency(currency));
</script>

{#if years.length > 0}
	<section class="card band">
		<div class="figure">
			<span class="label">Earned since {years[0].year}</span>
			<span class="mono value">
				{formatMinor(gross, currency)}<span class="unit">{symbol}</span>
			</span>
			<span class="sub">
				across {jurisdictions}
				{jurisdictions === 1 ? 'jurisdiction' : 'jurisdictions'}
			</span>
		</div>

		<div class="figure">
			<span class="label">Tax paid</span>
			<span class="mono value paid">
				{formatMinor(tax, currency)}<span class="unit">{symbol}</span>
			</span>
			<span class="sub">declared, not estimated</span>
		</div>

		<div class="figure">
			<span class="label">Blended rate</span>
			<span class="mono value rate">
				{blended === null ? '—' : `${blended.toFixed(2)}%`}
			</span>
			<span class="sub">lifetime, weighted by income</span>
		</div>

		{#if latest}
			<div class="figure">
				<span class="label">Latest year · {latest.year}</span>
				<span class="mono value">
					{formatMinor(BigInt(latest.grossMinor), currency)}<span class="unit">{symbol}</span>
				</span>
				<span class="sub" class:up={delta !== null && delta > 0n}>
					{#if delta === null}
						the first year on record
					{:else if delta === 0n}
						level with {previous!.year}
					{:else}
						{delta > 0n ? '+' : '−'}{formatMinor(delta < 0n ? -delta : delta, currency)}
						on {previous!.year}
					{/if}
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
	.figure {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
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
	.paid {
		color: var(--red);
	}
	.rate {
		color: var(--yellow);
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
	.sub.up {
		color: var(--green);
	}
</style>
