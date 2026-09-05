<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import SummaryBand from '$lib/components/SummaryBand.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import IconTile from '$lib/components/IconTile.svelte';
	import PeriodControls from '$lib/charts/PeriodControls.svelte';
	import MonthPairs from '$lib/charts/MonthPairs.svelte';
	import ShareBar from '$lib/charts/ShareBar.svelte';
	import { groupIcon } from '$lib/cashflow/group-icons';
	import { monthLabel } from '$lib/cashflow/period';
	import { displayCurrency, formatMinor, fromMajor } from '$lib/money';

	let { data } = $props();

	const fmt = (v: number) => formatMinor(fromMajor(v, data.baseCurrency), data.baseCurrency);
	const unit = $derived(displayCurrency(data.baseCurrency));

	// The same window the Overview panel shows as a waterfall, told here as
	// three answers instead: how each month compared, where the money went,
	// and where it came from. The waterfall stays on Overview; two screens
	// drawing the same Sankey was the same screen twice.
	// Biggest first, and only what money actually went to: a group that saw
	// nothing this window is a row saying nothing, and the reserves the
	// waterfall lists as a stage are where money came FROM — they are told on
	// the right.
	const groups = $derived(
		data.flow.breakdown
			.map((g) => ({
				...g,
				value: g.leaves.reduce((sum, leaf) => sum + leaf.value, 0),
				leafLine: g.leaves.map((leaf) => leaf.name).join(' · ')
			}))
			.filter((g) => g.value > 0)
			.sort((a, b) => b.value - a.value)
	);

	const drawdown = $derived(data.flow.totals.kept < 0 ? -data.flow.totals.kept : 0);
	const sources = $derived(
		[
			...data.flow.input.sources.map((s) => ({
				key: s.key,
				name: s.name,
				amount: s.amount,
				colorVar: s.colorVar ?? '--green'
			})),
			...(drawdown > 0
				? [{ key: 'reserves', name: 'From reserves', amount: drawdown, colorVar: '--red' }]
				: [])
		].filter((s) => s.amount > 0)
	);
	const largestSource = $derived(Math.max(1, ...sources.map((s) => s.amount)));

	const monthsRange = $derived(
		data.history.length
			? `${monthLabel(data.history[0].month)} – ${monthLabel(data.history[data.history.length - 1].month)}`
			: ''
	);
</script>

<ScreenHeader
	title="Cash flow"
	caption="Money in the order it is committed — what survives is what you keep."
/>

<section class="section">
	<PeriodControls
		period={data.flow.period}
		anchor={data.flow.anchor}
		bounds={data.flow.bounds}
		caption={data.flow.caption}
	/>

	<SummaryBand
		tiles={[
			// The wash says WHICH figure this is; the colour on the value says
			// whether it is good news. In and Saved carry both; Out is red ground
			// with plain ink, because money going out is not in itself a problem.
			{
				label: 'Money in',
				value: fmt(data.metrics.moneyIn),
				unit,
				color: 'var(--green)',
				wash: 'green'
			},
			{ label: 'Money out', value: fmt(data.metrics.moneyOut), unit, wash: 'red' },
			{
				label: 'Saved and invested',
				value: fmt(data.metrics.saved),
				unit,
				color: 'var(--green)',
				wash: 'teal'
			},
			{
				label: 'Biggest single line',
				value: data.metrics.biggest ? fmt(data.metrics.biggest.value) : '—',
				unit: data.metrics.biggest ? unit : undefined,
				note: data.metrics.biggest?.name
			}
		]}
	/>

	<div class="card">
		<Eyebrow hue="--teal" icon="bars" label="Month by month" caption={monthsRange}>
			{#snippet right()}
				<span class="legend">
					<span class="key"><span class="dot in"></span>In</span>
					<span class="key"><span class="dot out"></span>Out</span>
				</span>
			{/snippet}
		</Eyebrow>
		{#if data.history.length}
			<MonthPairs months={data.history} currency={data.baseCurrency} current={data.flow.anchor} />
		{:else}
			<p class="empty">The months appear once a statement has been imported.</p>
		{/if}
	</div>

	<div class="two">
		<div class="card went">
			<Eyebrow hue="--teal" icon="flow" label="Where it went" caption={data.flow.caption} />
			{#if groups.length}
				<ShareBar
					segments={groups.map((g) => ({
						key: g.key,
						pct: g.pct,
						colorVar: g.colorVar,
						label: g.label
					}))}
				/>
				<div class="rows">
					{#each groups as g (g.key)}
						<div class="row">
							<IconTile hue={g.colorVar} icon={groupIcon(g.key)} size={30} />
							<span class="name">
								<span class="label">{g.label}</span>
								{#if g.leafLine}<span class="leaves">{g.leafLine}</span>{/if}
							</span>
							<span class="mono amount">{fmt(g.value)}</span>
							<span class="mono pct" style:--chip-hue="var({g.colorVar})">{g.pct}%</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="empty">Nothing left the accounts in this window.</p>
			{/if}
		</div>

		<div class="card came">
			<Eyebrow hue="--green" icon="coins" label="Where it came from" />
			{#if sources.length}
				<div class="sources">
					{#each sources as s (s.key)}
						<div class="source">
							<span class="s-line">
								<span class="label">{s.name}</span>
								<span class="mono amount">{fmt(s.amount)}</span>
							</span>
							<span class="track">
								<span
									class="fill"
									style:width="{Math.round((s.amount / largestSource) * 100)}%"
									style:background="var({s.colorVar})"
								></span>
							</span>
						</div>
					{/each}
				</div>
				<p class="note">
					{#if drawdown > 0}
						Reserves cover what income did not. That is the
						<span class="mono" style="color: var(--red);">{fmt(data.flow.totals.kept)} {unit}</span>
						kept this period.
					{:else}
						Everything spent came out of the period's own income;
						<span class="mono" style="color: var(--green);"
							>{fmt(data.flow.totals.kept)} {unit}</span
						>
						was kept.
					{/if}
				</p>
			{:else}
				<p class="empty">No income landed in this window.</p>
			{/if}
		</div>
	</div>
</section>

<style>
	.section {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		min-width: 0;
	}
	.legend {
		display: flex;
		gap: var(--space-6);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.key {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 3px;
	}
	.dot.in {
		background: var(--green);
	}
	.dot.out {
		background: var(--red);
	}

	.two {
		display: grid;
		grid-template-columns: 1.3fr 1fr;
		gap: var(--space-7);
	}
	@media (max-width: 899px) {
		.two {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.rows {
		display: flex;
		flex-direction: column;
	}
	.row {
		display: grid;
		grid-template-columns: 30px minmax(0, 1fr) auto auto;
		align-items: center;
		gap: var(--space-6);
		padding: var(--space-5) 0;
		border-top: 1px solid var(--bd);
	}
	.name {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.label {
		font-size: var(--text-md);
		font-weight: 500;
	}
	.leaves {
		font-size: var(--text-xs);
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.amount {
		font-size: var(--text-md);
		font-weight: 600;
	}
	/* The share as a chip in the group's own hue: the same colour the bar
	   above and the row's tile carry, so the three read as one thing. */
	.pct {
		font-size: var(--text-xs);
		padding: 2px var(--space-4);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--chip-hue) 16%, transparent);
		color: color-mix(in srgb, var(--fg1) var(--series-ink-mix), var(--chip-hue));
		min-width: 44px;
		text-align: center;
	}

	.sources {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.source {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.s-line {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-5);
		font-size: var(--text-md);
	}
	.track {
		display: block;
		height: 8px;
		border-radius: var(--radius-pill);
		background: var(--card3);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: var(--radius-pill);
		transition: width var(--dur-slow) var(--ease);
	}
	.note,
	.empty {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
		line-height: 1.5;
	}
	.empty {
		padding: var(--space-8) 0;
		text-align: center;
	}
</style>
