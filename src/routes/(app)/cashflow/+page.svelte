<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import SummaryBand from '$lib/components/SummaryBand.svelte';
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

	<FlowCard flow={data.flow} currency={data.baseCurrency} />

	<MonthHistoryChart
		months={data.history.months}
		currency={data.baseCurrency}
		savedRate={data.history.savedRate}
		negativeMonths={data.history.negativeMonths}
	/>
</section>
