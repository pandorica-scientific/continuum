<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// One chart for the whole record, replacing six per-currency panels.
	//
	// Two modes over one x axis. In `stack`, each bar's full height IS that
	// year's gross: its foot is the tax, hatched, and what stands above is what
	// was kept. In `rate`, the bars give way to one line per jurisdiction.
	//
	// Both are drawn by the shared LineChart now. This file used to carry its own
	// letterboxed viewBox with HTML axis labels positioned in percentages over
	// it, and SalaryYearChart carried a second copy of the same arrangement; the
	// two had already drifted on bar width and readout placement. What is left
	// here is what a TAX bar means — the hatched foot, the jurisdictions, and the
	// blended rate that is the honest line whatever the currency.
	//
	// One SVG fact still governs the fills below: an SVG attribute does not
	// resolve var(), so `fill` goes through `style` in the defs, and the bars
	// refer to those defs by `url(#id)`, which IS legal as an attribute.
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import LineChart from './LineChart.svelte';
	import type { BarSlot, LineSeries } from './line';
	import { displayCurrency, formatMinor } from '$lib/money';
	import { maxGross, taxBarSegments, type SerialisedYear } from '$lib/charts/tax-chart-geometry';

	let {
		years,
		countries,
		currency,
		currencies,
		mode = $bindable(),
		onchange
	}: {
		years: SerialisedYear[];
		countries: { code: string; name: string; token: string }[];
		currency: string;
		currencies: string[];
		mode: 'stack' | 'rate';
		onchange: (next: { mode?: 'stack' | 'rate'; currency?: string }) => void;
	} = $props();

	// Writable derived: the segmented control binds to it, and a new currency
	// arriving from the server after a save overwrites what was bound.
	let displayCurrencyCode = $derived(currency);

	const hues = $derived(new Map(countries.map((c) => [c.code, c.token])));
	const nameOf = $derived(new Map(countries.map((c) => [c.code, c.name])));
	const ceiling = $derived(maxGross(years));

	/** Only the jurisdictions that actually appear, so the legend has no ghosts. */
	const present = $derived(
		countries.filter((c) => years.some((y) => y.byCountry.some((b) => b.country === c.code)))
	);

	/**
	 * All the tax first, then all the kept — so the hatched foot is one block
	 * rather than interleaved with what was kept. Values are minor units; the
	 * axis divides them down for its own labels.
	 */
	const barSlots = $derived<BarSlot[]>(
		mode === 'rate' ? [] : years.map((row) => ({ segments: taxBarSegments(row, hues) }))
	);

	/**
	 * One line per jurisdiction, plus the household's blended rate.
	 *
	 * A null breaks the line rather than bridging it: a year somebody lived
	 * elsewhere is not a year their rate quietly held steady — the rule
	 * `rateRuns` was written for, now enforced by the engine's own null
	 * handling.
	 *
	 * In `stack` mode only the blended line is drawn; four jurisdiction lines
	 * over a stack of bars is two charts fighting for one band.
	 */
	const series = $derived<LineSeries[]>([
		...(mode === 'rate'
			? present.map((c) => ({
					key: c.code,
					colorVar: c.token,
					endLabel: c.code,
					points: years.map((y) => ({
						value: y.byCountry.find((b) => b.country === c.code)?.ratePct ?? null
					}))
				}))
			: []),
		{
			key: 'blended',
			// Yellow, because that is the colour a rate wears everywhere else on
			// this screen — the blended-rate tile and each row's own percentage.
			colorVar: '--yellow',
			endLabel: 'all',
			points: years.map((y) => ({ value: y.ratePct }))
		}
	]);

	/** The y-axis unit follows the display currency's own magnitude. */
	const unitStep = $derived.by(() => {
		const top = Number(ceiling) / 100;
		if (top >= 1_000_000) return { divisor: 1_000_000 * 100, label: 'Millions' };
		if (top >= 1_000) return { divisor: 1_000 * 100, label: 'Thousands' };
		return { divisor: 100, label: '' };
	});
	const axisUnit = $derived(`${unitStep.label} ${displayCurrency(currency)}`.trim());
</script>

<section class="card chart">
	<div class="head">
		<Eyebrow
			hue="--teal"
			icon="trend"
			label={mode === 'stack' ? 'Earned & paid' : 'Effective rate'}
			caption={mode === 'stack' ? axisUnit : 'blended, per jurisdiction'}
		/>
		<div class="controls">
			<Segmented
				options={[
					{ value: 'stack', label: 'Earned & paid' },
					{ value: 'rate', label: 'Effective rate' }
				]}
				bind:value={mode}
				onchange={(next) => onchange({ mode: next as 'stack' | 'rate' })}
			/>
			{#if currencies.length > 1}
				<Segmented
					options={currencies.map((c) => ({ value: c, label: displayCurrency(c) }))}
					bind:value={displayCurrencyCode}
					onchange={(next) => onchange({ currency: next })}
				/>
			{/if}
		</div>
	</div>

	{#if years.length === 0}
		<p class="empty">Nothing filed yet — the chart draws itself once a statement is recorded.</p>
	{:else}
		<LineChart
			{series}
			bars={barSlots}
			labels={years.map((y) => String(y.year))}
			height={mode === 'rate' ? 300 : 340}
			title="Tax by year"
			description="Each bar is a year's gross, with the tax paid hatched at its foot, and the effective rate beneath."
			format={(v) => `${Math.round(v)}%`}
			barFormat={(v) => String(Math.round(v / unitStep.divisor))}
			axisTitle="Rate"
			barAxisTitle={axisUnit}
			slotLabel={(i) => `${years[i].year} figures`}
		>
			{#snippet defs()}
				{#each present as c (c.code)}
					<linearGradient id="tax-fill-{c.code}" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" style="stop-color: var({c.token}); stop-opacity: 0.62" />
						<stop offset="1" style="stop-color: var({c.token}); stop-opacity: 0.42" />
					</linearGradient>
					<pattern
						id="tax-hatch-{c.code}"
						width="7"
						height="7"
						patternUnits="userSpaceOnUse"
						patternTransform="rotate(45)"
					>
						<rect width="7" height="7" style="fill: var({c.token}); fill-opacity: 0.12" />
						<line
							x1="0"
							y1="0"
							x2="0"
							y2="7"
							style="stroke: var({c.token}); stroke-opacity: 0.5; stroke-width: 2.6"
						/>
					</pattern>
				{/each}
			{/snippet}

			<!-- One readout per year, not per mark: a per-mark tooltip cannot answer
			     "which country is this AND what were the others that year". -->
			{#snippet readout(i)}
				{@const row = years[i]}
				<span class="r-year mono">{row.year}</span>
				{#each row.byCountry as c (c.country)}
					<div class="r-row">
						<span class="swatch" style="background: var({hues.get(c.country)})"></span>
						<span class="r-name">{nameOf.get(c.country) ?? c.country}</span>
						<span class="mono r-rate">{c.ratePct === null ? '—' : `${c.ratePct.toFixed(2)}%`}</span>
					</div>
					<div class="r-figures">
						earned <strong class="mono">{formatMinor(BigInt(c.grossMinor), currency)}</strong>
						· tax <strong class="mono">{formatMinor(BigInt(c.taxMinor), currency)}</strong>
						{#each c.native ?? [] as n, j (j)}
							<span class="r-filed"
								>filed {formatMinor(BigInt(n.grossMinor), n.currency)}
								{displayCurrency(n.currency)}</span
							>
						{/each}
					</div>
				{/each}
				{#if row.byCountry.length > 1}
					<div class="r-total">
						<span>all</span>
						<strong class="mono">{formatMinor(BigInt(row.grossMinor), currency)}</strong>
						<span class="mono">{row.ratePct === null ? '—' : `${row.ratePct.toFixed(2)}%`}</span>
					</div>
				{/if}
			{/snippet}

			{#snippet legend()}
				{#each present as c (c.code)}
					<span class="key">
						<span class="swatch" style="background: var({c.token})"></span>
						{c.name}
					</span>
				{/each}
				<!-- Only where there are bars to describe. In rate mode the
				     jurisdiction keys still mean the lines, but this one named a
				     texture that is not on screen. -->
				{#if mode === 'stack'}
					<span class="key">
						<span class="swatch dashed"></span>
						bar = earned · hatched foot = tax paid
					</span>
				{/if}
				<span class="key">
					<span class="swatch rate-key"></span>
					effective rate
				</span>
				<span class="footnote">
					{mode === 'stack'
						? "Converted at each year's closing rate — comparison, not a filed figure"
						: 'Rates need no conversion, which is why this line was always the honest one'}
				</span>
			{/snippet}
		</LineChart>
	{/if}
</section>

<style>
	.chart {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.controls {
		display: flex;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.empty {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
		line-height: 1.55;
	}

	/* The readout's and legend's own rows. `:global` because that markup is
	   rendered inside LineChart, which scopes its own styles and not these. */
	.chart :global(.r-year) {
		display: block;
		font-size: var(--text-xs);
		color: var(--fg3);
		margin-bottom: var(--space-3);
	}
	.chart :global(.r-row) {
		display: grid;
		grid-template-columns: 10px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-4);
		color: var(--fg1);
	}
	.chart :global(.r-name) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chart :global(.r-rate) {
		font-size: var(--text-xs);
	}
	/* Indented under the country it belongs to, so a two-jurisdiction year is
	   two blocks rather than four unattributed lines. */
	.chart :global(.r-figures) {
		padding: 0 0 var(--space-4) 22px;
		font-size: var(--text-xs);
		color: var(--fg3);
		line-height: 1.5;
	}
	.chart :global(.r-filed) {
		display: block;
		opacity: 0.85;
	}
	.chart :global(.r-total) {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: var(--space-4);
		padding-top: var(--space-3);
		border-top: 1px solid var(--bd);
		font-size: var(--text-xs);
		color: var(--fg2);
	}

	.chart :global(.swatch) {
		width: 10px;
		height: 10px;
		border-radius: var(--radius-xs);
		flex: none;
	}
	/* The two keys that stand for a texture rather than a colour. */
	.chart :global(.swatch.dashed) {
		background: repeating-linear-gradient(45deg, var(--fg3) 0 2px, transparent 2px 5px);
	}
	.chart :global(.swatch.rate-key) {
		background: var(--yellow);
		height: 3px;
		border-radius: var(--radius-pill);
	}

	.chart :global(.key) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* At the end of the keys' own row where it fits, on its own line where it
	   does not — `margin-left: auto` against a wrapping flex row does both. */
	.chart :global(.footnote) {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--fg3);
		line-height: 1.5;
	}
</style>
