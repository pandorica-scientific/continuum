<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Salary by year, drawn by the shared LineChart. What's left in this file is
	// what a salary bar MEANS — base, bonus, net, and the change line over the top.
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
	const anyEquity = $derived(years.some((y) => BigInt(y.equityTotalMinor) > 0n));
	const anyUnvested = $derived(years.some((y) => BigInt(y.equityUnvestedMinor) > 0n));

	/**
	 * Bars in minor units, which is what the ledger stores and what the readout
	 * formats. Bonus at the foot, base above it, so a bonus that changes size
	 * doesn't move the base's boundary.
	 */
	const barSlots = $derived<BarSlot[]>(
		mode === 'change'
			? []
			: years.map((row) => ({
					segments: salaryBarSegments(row, mode),
					// Net is not a segment: it's what was LEFT of the same gross, so it crosses as a tick.
					tick: (() => {
						const net = barValues(row, mode).net;
						return net === null ? null : Number(net);
					})()
				}))
	);

	/**
	 * Two lines, and only two: the salary, and everything.
	 *
	 * Salary is the base — no bonus, no grant — which is the figure that answers
	 * "did my pay go up", because a one-off award moves a total up one year and
	 * down the next and reads as a raise followed by a cut. Total is the whole
	 * package beside it: pay, bonus and whatever was granted that year.
	 *
	 * The gap between them IS the variable pay, which is the thing worth seeing.
	 * A third line for gross-with-bonus-but-not-equity used to sit between them
	 * and answered no question anybody asks.
	 */
	const series = $derived<LineSeries[]>([
		{
			key: 'base',
			colorVar: '--series-health',
			dashed: true,
			endLabel: 'salary',
			points: years.map((y) => ({ value: y.baseDeltaPct }))
		},
		{
			key: 'total',
			colorVar: '--teal',
			endLabel: 'total',
			points: years.map((y) => ({ value: y.compDeltaPct }))
		}
	]);

	/** What the money axis counts in — the unit moves into the axis title so labels stay short. */
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
		change:
			'Salary is base pay alone, so a one-off award does not read as a raise and then a cut; total adds the bonus and anything granted'
	};
</script>

<section class="card chart">
	<div class="head">
		<Eyebrow
			hue="--teal"
			icon="wallet"
			label={LABEL[mode]}
			caption={mode === 'change' ? 'per cent on the year before' : axisUnit}
		/>
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
				<linearGradient id="salary-equity" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" style="stop-color: var(--purple); stop-opacity: 0.5" />
					<stop offset="1" style="stop-color: var(--purple); stop-opacity: 0.15" />
				</linearGradient>
				<pattern
					id="salary-equity-unvested"
					width="6"
					height="6"
					patternUnits="userSpaceOnUse"
					patternTransform="rotate(45)"
				>
					<rect width="6" height="6" style="fill: var(--purple); fill-opacity: 0.06" />
					<line
						x1="0"
						y1="0"
						x2="0"
						y2="6"
						style="stroke: var(--purple); stroke-opacity: 0.32; stroke-width: 1.6"
					/>
				</pattern>
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
				<!-- base + bonus IS gross; stated rather than left to be added up by eye. -->
				<div class="r-row total">
					<span class="swatch gross"></span>
					<span>gross</span>
					<strong class="mono">{formatMinor(v.base + v.bonus, currency)}</strong>
				</div>
				{#if v.equity > 0n}
					<div class="r-row">
						<span class="swatch equity"></span>
						<span>equity vested</span>
						<strong class="mono">{formatMinor(v.equity, currency)}</strong>
					</div>
				{/if}
				{#if v.equityUnvested > 0n}
					<div class="r-row">
						<span class="swatch equity-unvested"></span>
						<span>equity to vest</span>
						<strong class="mono">{formatMinor(v.equityUnvested, currency)}</strong>
					</div>
				{/if}
				{#if v.net !== null}
					<div class="r-row">
						<span class="swatch net"></span>
						<span>net</span>
						<strong class="mono">{formatMinor(v.net, currency)}</strong>
					</div>
				{/if}
				<div class="r-foot">
					{#if row.baseDeltaPct !== null}
						<span>{row.baseDeltaPct > 0 ? '+' : ''}{row.baseDeltaPct}% salary</span>
					{/if}
					{#if row.compDeltaPct !== null}
						<span>{row.compDeltaPct > 0 ? '+' : ''}{row.compDeltaPct}% total</span>
					{/if}
					<span class="months">
						{row.grossMonths} gross · {row.netMonths} net
						{#if !row.netComplete && row.netMonths > 0}⚠{/if}
					</span>
				</div>
			{/snippet}

			{#snippet legend()}
				<!-- Bar keys only where there are bars — Change mode has none. -->
				{#if mode !== 'change'}
					<span class="key"><span class="swatch base"></span> base salary</span>
					{#if anyBonus}
						<span class="key"><span class="swatch bonus"></span> bonus</span>
					{/if}
					{#if anyEquity}
						<span class="key"><span class="swatch equity"></span> equity vested</span>
					{/if}
					{#if anyUnvested}
						<span class="key">
							<span class="swatch equity-unvested"></span> equity to vest · at today's close
						</span>
					{/if}
					<span class="key"><span class="swatch net"></span> net</span>
				{/if}
				<span class="key">
					<span class="swatch line-base"></span> salary only · no bonus{anyEquity
						? ' or equity'
						: ''}
				</span>
				<span class="key">
					<span class="swatch line-total"></span> total · bonus{anyEquity ? ' and equity' : ''} included
				</span>
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

	/* `:global` because this markup renders inside LineChart, which scopes its own styles. */
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
	.chart :global(.swatch.equity) {
		background: color-mix(in srgb, var(--purple) 45%, transparent);
	}
	.chart :global(.swatch.equity-unvested) {
		background: color-mix(in srgb, var(--purple) 16%, transparent);
		border: 1px dashed color-mix(in srgb, var(--purple) 55%, transparent);
	}
	.chart :global(.swatch.gross) {
		background: var(--bd2);
	}
	.chart :global(.swatch.net) {
		background: var(--fg1);
	}
	.chart :global(.swatch.line-base) {
		background: var(--series-health);
	}
	.chart :global(.swatch.line-total) {
		background: var(--teal);
	}

	.chart :global(.key) {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* `margin-left: auto` in a wrapping flex row puts this at the row's end, or its own line. */
	.chart :global(.footnote) {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--fg3);
		line-height: 1.5;
	}
</style>
