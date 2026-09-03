<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Salary by year, drawn by the shared LineChart.
	//
	// It used to own a letterboxed viewBox of its own, with HTML axis labels
	// positioned in percentages on top of it because text inside a scaled SVG
	// scales too. TaxYearChart owned a second copy of the same arrangement, and
	// the two had already drifted on bar width and readout placement. Both now
	// hand LineChart their values; what is left in this file is what a salary
	// bar MEANS — base, bonus, net, and the change line over the top.
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import LineChart from './LineChart.svelte';
	import type { BarSlot, LineSeries } from './line';
	import { displayCurrency, formatMinor } from '$lib/money';
	import {
		barValues,
		ceilingFor,
		salaryBarSegments,
		type SalaryMode,
		type SerialisedSalaryYear
	} from '$lib/charts/salary-chart-geometry';

	let {
		years,
		currency,
		mode = $bindable(),
		onchange
	}: {
		years: SerialisedSalaryYear[];
		currency: string;
		mode: SalaryMode;
		onchange: (next: SalaryMode) => void;
	} = $props();

	const anyBonus = $derived(years.some((y) => BigInt(y.bonusTotalMinor) > 0n));

	/**
	 * Bars in minor units, which is what the ledger stores and what the readout
	 * formats. The axis divides them down to thousands or millions for its own
	 * labels; nothing else here needs to know about that.
	 *
	 * Bonus at the foot, base above it — the order `bars()` used to place them
	 * in, and for the reason it recorded: the other way round, a bonus that
	 * changed size every year moved the base's boundary for a reason that had
	 * nothing to do with the base.
	 */
	const barSlots = $derived<BarSlot[]>(
		mode === 'change'
			? []
			: years.map((row) => ({
					segments: salaryBarSegments(row, mode),
					// Net is not a segment: it is what was LEFT of the same gross
					// rather than a further amount stacked on it, so it crosses.
					tick: (() => {
						const net = barValues(row, mode).net;
						return net === null ? null : Number(net);
					})()
				}))
	);

	// The base line is the one that answers "did my salary go up". The total
	// moves with a one-off bonus and reads as a raise.
	const series = $derived<LineSeries[]>([
		{
			key: 'total',
			colorVar: '--teal',
			endLabel: anyBonus ? 'total' : 'change',
			points: years.map((y) => ({ value: y.deltaPct }))
		},
		...(anyBonus
			? [
					{
						key: 'base',
						colorVar: '--series-health',
						dashed: true,
						endLabel: 'base',
						points: years.map((y) => ({ value: y.baseDeltaPct }))
					}
				]
			: [])
	]);

	/**
	 * What the money axis counts in.
	 *
	 * Six-figure koruna printed against every gridline is a wall of digits, so
	 * the unit moves into the axis title and the labels shrink to two or three
	 * characters — the job `compactAxis` did for the old fixed grid.
	 */
	const ceiling = $derived(ceilingFor(years, mode));
	const unitStep = $derived.by(() => {
		const top = Number(ceiling) / 100;
		if (top >= 1_000_000) return { divisor: 1_000_000 * 100, label: 'Millions' };
		if (top >= 1_000) return { divisor: 1_000 * 100, label: 'Thousands' };
		return { divisor: 100, label: '' };
	});
	const axisUnit = $derived(`${unitStep.label} ${displayCurrency(currency)}`.trim());

	const LABEL: Record<SalaryMode, string> = {
		avg: 'Average month',
		total: 'Yearly total',
		change: 'Year on year'
	};

	const FOOTNOTE: Record<SalaryMode, string> = {
		total:
			'A year with fewer than twelve months is marked in its readout — a partial year is not a small one',
		avg: 'Averaged over the months actually recorded, so a part year compares as a monthly rate',
		change: 'Base excludes bonuses, so a one-off award does not read as a raise and then a cut'
	};
</script>

<section class="card chart">
	<div class="head">
		<Eyebrow hue="--teal" emoji="💼" label={LABEL[mode]} />
		<Segmented
			options={[
				{ value: 'avg', label: 'Average month' },
				{ value: 'total', label: 'Yearly total' },
				{ value: 'change', label: 'Change' }
			]}
			bind:value={mode}
			onchange={(next) => onchange(next as SalaryMode)}
		/>
	</div>

	{#if years.length === 0}
		<p class="empty">
			Nothing recorded yet — upload a payslip below, or categorise a salary credit on the
			Transactions screen, and the history draws itself.
		</p>
	{:else}
		<LineChart
			{series}
			bars={barSlots}
			labels={years.map((y) => String(y.year))}
			height={mode === 'change' ? 300 : 340}
			title="Salary by year"
			description="Gross split into base and bonus, with net marked across each bar, and the year-on-year change beneath."
			format={(v) => `${Math.round(v)}%`}
			barFormat={(v) => String(Math.round(v / unitStep.divisor))}
			axisTitle="Change"
			barAxisTitle={axisUnit}
			slotLabel={(i) => `${years[i].year} figures`}
		>
			{#snippet defs()}
				<linearGradient id="salary-base" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" style="stop-color: var(--series-health-soft); stop-opacity: 0.62" />
					<stop offset="1" style="stop-color: var(--series-health-soft); stop-opacity: 0.42" />
				</linearGradient>
				<pattern
					id="salary-bonus"
					width="7"
					height="7"
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<rect width="7" height="7" style="fill: var(--orange); fill-opacity: 0.12" />
					<line
						x1="0"
						y1="0"
						x2="0"
						y2="7"
						style="stroke: var(--orange); stroke-opacity: 0.5; stroke-width: 2.6"
					/>
				</pattern>
			{/snippet}

			{#snippet readout(i)}
				{@const row = years[i]}
				{@const v = barValues(row, mode === 'change' ? 'total' : mode)}
				<span class="r-year mono">{row.year}</span>
				<div class="r-row">
					<span class="swatch base"></span>
					<span>base</span>
					<strong class="mono">{formatMinor(v.base, currency)}</strong>
				</div>
				{#if v.bonus > 0n}
					<div class="r-row">
						<span class="swatch bonus"></span>
						<span>bonus</span>
						<strong class="mono">{formatMinor(v.bonus, currency)}</strong>
					</div>
				{/if}
				<!-- The sum the bar actually draws. base + bonus IS gross, and with the
				     two stacked it is worth stating rather than leaving to be added up
				     by eye — especially beside net, which is what was left of this same
				     figure rather than a further amount. -->
				<div class="r-row total">
					<span class="swatch gross"></span>
					<span>gross</span>
					<strong class="mono">{formatMinor(v.base + v.bonus, currency)}</strong>
				</div>
				{#if v.net !== null}
					<div class="r-row">
						<span class="swatch net"></span>
						<span>net</span>
						<strong class="mono">{formatMinor(v.net, currency)}</strong>
					</div>
				{/if}
				<div class="r-foot">
					{#if row.deltaPct !== null}
						<span>{row.deltaPct > 0 ? '+' : ''}{row.deltaPct}% total</span>
					{/if}
					{#if row.baseDeltaPct !== null && anyBonus}
						<span>{row.baseDeltaPct > 0 ? '+' : ''}{row.baseDeltaPct}% base</span>
					{/if}
					<span class="months">
						{row.grossMonths} gross · {row.netMonths} net
						{#if !row.netComplete && row.netMonths > 0}⚠{/if}
					</span>
				</div>
			{/snippet}

			{#snippet legend()}
				<!-- The bar keys only where there are bars. In Change mode they named
				     three fills that are not on screen. -->
				{#if mode !== 'change'}
					<span class="key"><span class="swatch base"></span> base salary</span>
					{#if anyBonus}
						<span class="key"><span class="swatch bonus"></span> bonus</span>
					{/if}
					<span class="key"><span class="swatch net"></span> net</span>
				{/if}
				<span class="key"><span class="swatch line-total"></span> change, total</span>
				{#if anyBonus}
					<span class="key"><span class="swatch line-base"></span> change, base only</span>
				{/if}
				<span class="footnote">{FOOTNOTE[mode]}</span>
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
		gap: var(--space-6);
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
		padding: 1px 0;
		color: var(--fg2);
	}
	.chart :global(.r-row.total) {
		color: var(--fg1);
	}
	.chart :global(.r-foot) {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-top: var(--space-3);
		padding-top: var(--space-3);
		border-top: 1px solid var(--bd);
		font-size: var(--text-xs);
		color: var(--fg3);
	}

	.chart :global(.swatch) {
		width: 10px;
		height: 10px;
		border-radius: var(--radius-xs);
		flex: none;
	}
	.chart :global(.swatch.base) {
		background: color-mix(in srgb, var(--series-health-soft) 55%, transparent);
	}
	.chart :global(.swatch.bonus) {
		background: color-mix(in srgb, var(--orange) 45%, transparent);
	}
	.chart :global(.swatch.gross) {
		background: var(--bd2);
	}
	.chart :global(.swatch.net) {
		background: var(--fg1);
	}
	.chart :global(.swatch.line-total) {
		background: var(--teal);
	}
	.chart :global(.swatch.line-base) {
		background: var(--series-health);
	}

	.chart :global(.key) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.chart :global(.footnote) {
		flex-basis: 100%;
		font-size: var(--text-xs);
		color: var(--fg3);
		line-height: 1.5;
	}
</style>
