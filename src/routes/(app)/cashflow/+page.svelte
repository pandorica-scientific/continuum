<script lang="ts">
	import { goto } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import MetricTile from '$lib/components/MetricTile.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import FlowCard from '$lib/charts/FlowCard.svelte';
	import { displayCurrency, formatMinor, fromMajor } from '$lib/money';

	let { data } = $props();

	const fmt = (v: number) => formatMinor(fromMajor(v, data.baseCurrency), data.baseCurrency);
	const unit = $derived(displayCurrency(data.baseCurrency));

	const maxMonth = $derived(
		Math.max(...data.history.months.map((m) => Math.max(m.earned, m.spent)), 1)
	);
</script>

<ScreenHeader
	title="Cash flow"
	caption="Money in the order it is committed — what survives is what you keep."
/>

<section class="section">
	<div class="eyebrow-row">
		<Segmented
			options={[
				{ value: 'ytd', label: 'Year to date' },
				{ value: 'month', label: 'This month' }
			]}
			value={data.period}
			onchange={(v) => goto(`?period=${v}`, { keepFocus: true, noScroll: true })}
		/>
		<span class="eyebrow-caption">{data.flow.caption} · click a period to redraw</span>
	</div>

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

	<div class="card history">
		<div class="eyebrow-row">
			<Eyebrow emoji="📊" label="Every month on record" />
			<span class="eyebrow-caption">
				{#if data.history.months.length}
					{data.history.months[0].month} – {data.history.months[data.history.months.length - 1]
						.month} · {data.history.savedRate}% saved on average
				{:else}
					appears once statements are imported
				{/if}
			</span>
		</div>
		{#if data.history.months.length}
			<div class="bars">
				{#each data.history.months as m (m.month)}
					<div class="pair" title="{m.month}: earned {fmt(m.earned)}, spent {fmt(m.spent)} {unit}">
						<div class="bar in" style:height="{(m.earned / maxMonth) * 100}%"></div>
						<div class="bar out" style:height="{(m.spent / maxMonth) * 100}%"></div>
					</div>
				{/each}
			</div>
			<div class="years mono">
				{#each data.history.years as y (y)}
					<span>{y}</span>
				{/each}
			</div>
			<div class="legend">
				<span class="l-item"><span class="l-dot in"></span>earned</span>
				<span class="l-item"><span class="l-dot out"></span>spent</span>
				<span class="l-note">
					{data.history.negativeMonths === 0
						? 'no month spent more than it earned'
						: `${data.history.negativeMonths} months spent more than they earned`}
				</span>
			</div>
		{/if}
	</div>
</section>

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
	}
	.history {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 168px;
	}
	.pair {
		flex: 1 1 0;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 1px;
		height: 100%;
		min-width: 0;
	}
	.bar {
		flex: 1 1 0;
		border-radius: 2px 2px 0 0;
	}
	.bar.in {
		background: var(--green);
		opacity: 0.85;
	}
	.bar.out {
		background: var(--red);
		opacity: 0.8;
	}
	.years {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: var(--fg3);
	}
	.legend {
		display: flex;
		gap: 18px;
		font-size: 12.5px;
		color: var(--fg2);
		border-top: 1px solid var(--bd);
		padding-top: 11px;
	}
	.l-item {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.l-dot {
		width: 10px;
		height: 10px;
		border-radius: 3px;
	}
	.l-dot.in {
		background: var(--green);
	}
	.l-dot.out {
		background: var(--red);
	}
	.l-note {
		margin-left: auto;
		color: var(--fg3);
	}
</style>
