<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import MetricTile from '$lib/components/MetricTile.svelte';
	import FlowCard from '$lib/charts/FlowCard.svelte';
	import PeriodControls from '$lib/charts/PeriodControls.svelte';
	import MonthHistoryChart from '$lib/charts/MonthHistoryChart.svelte';
	import { displayCurrency, formatMinor, fromMajor } from '$lib/money';

	let { data } = $props();

	const fmt = (v: number) => formatMinor(fromMajor(v, data.baseCurrency), data.baseCurrency);
	const unit = $derived(displayCurrency(data.baseCurrency));
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

	<div class="tiles">
		<MetricTile label="Money in" value={fmt(data.metrics.moneyIn)} {unit} color="var(--green)" />
		<MetricTile label="Money out" value={fmt(data.metrics.moneyOut)} {unit} />
		<MetricTile
			label="Saved and invested"
			value={fmt(data.metrics.saved)}
			{unit}
			color="var(--green)"
		/>
		<MetricTile
			label="Biggest single line"
			value={data.metrics.biggest ? fmt(data.metrics.biggest.value) : '—'}
			unit={data.metrics.biggest ? unit : undefined}
			note={data.metrics.biggest?.name}
		/>
	</div>

	<FlowCard flow={data.flow} currency={data.baseCurrency} />

	<MonthHistoryChart
		months={data.history.months}
		currency={data.baseCurrency}
		savedRate={data.history.savedRate}
		negativeMonths={data.history.negativeMonths}
	/>
</section>

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-6);
	}
</style>
