<script lang="ts">
	import { goto } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import FlowCard from '$lib/charts/FlowCard.svelte';

	let { data } = $props();

	const monthName = new Date().toLocaleString('en', { month: 'long', year: 'numeric' });
</script>

<ScreenHeader
	emoji="🧭"
	title="Overview"
	caption="{monthName} · what needs you and where the money goes"
/>

<section class="section">
	<div class="eyebrow-row">
		<Eyebrow emoji="🔔" label="Needs you" />
		<span class="eyebrow-caption">{data.briefing.caption}</span>
	</div>
	{#if data.briefing.items.length}
		<div class="briefing">
			{#each data.briefing.items as item (item.title)}
				<a href={item.href} class="brief-card">
					<span class="b-top">
						<span>{item.emoji}</span><span>{item.kind}</span>
						<span class="b-pill"><Pill hue={item.hue}>{item.pill}</Pill></span>
					</span>
					<span class="b-title">{item.title}</span>
					<span class="b-detail">{item.detail}</span>
				</a>
			{/each}
		</div>
	{:else}
		<div class="card"><span class="quiet">Nothing needs a decision right now.</span></div>
	{/if}
</section>

<section class="section" style="gap: 16px;">
	<div class="eyebrow-row">
		<div class="heading-row">
			<span class="heading">Where the money goes</span>
			<span class="eyebrow-caption">{data.flow.caption}</span>
		</div>
		<Segmented
			options={[
				{ value: 'ytd', label: 'Year to date' },
				{ value: 'month', label: 'This month' }
			]}
			value={data.period}
			onchange={(v) => goto(`?period=${v}`, { keepFocus: true, noScroll: true })}
		/>
	</div>
	<FlowCard flow={data.flow} currency={data.baseCurrency} />
</section>

<section class="grid-2">
	<div class="card stack">
		<Eyebrow emoji="🧩" label="What it is made of" />
		{#each data.composition as c (c.label)}
			<div class="comp">
				<span class="c-label">{c.label}</span>
				<span class="mono c-value" style:color="var({c.colorVar})">{c.value}</span>
				<div class="c-track">
					<div class="c-fill" style:width="{c.width}%" style:background="var({c.colorVar})"></div>
				</div>
				<span class="c-detail">{c.detail}</span>
			</div>
		{/each}
	</div>

	<div class="card stack">
		<div class="eyebrow-row">
			<Eyebrow emoji="📅" label="Next 30 days" />
			<a href="/calendar" class="open-link">Open calendar →</a>
		</div>
		<span class="quiet">
			Upcoming payments and events appear here once the calendar module lands in Phase 3.
		</span>
	</div>
</section>

<style>
	.briefing {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(258px, 1fr));
		gap: 10px;
	}
	.brief-card {
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 7px;
		background: var(--card);
		border: 1px solid var(--bd);
		border-radius: 10px;
		padding: 13px 15px;
		color: var(--fg1);
	}
	.brief-card:hover {
		background: var(--card2);
		text-decoration: none;
	}
	.b-top {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--fg3);
	}
	.b-pill {
		margin-left: auto;
	}
	.b-title {
		font-size: 14px;
		font-weight: 500;
		line-height: 1.35;
	}
	.b-detail {
		font-size: 12.5px;
		color: var(--fg3);
		line-height: 1.5;
	}
	.heading-row {
		display: flex;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
	}
	.heading {
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.grid-2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 16px;
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.comp {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px 12px;
	}
	.c-label {
		font-size: 13.5px;
		color: var(--fg2);
	}
	.c-value {
		font-size: 13.5px;
		text-align: right;
	}
	.c-track {
		grid-column: 1 / -1;
		height: 6px;
		background: var(--card3);
		border-radius: 4px;
		overflow: hidden;
	}
	.c-fill {
		height: 100%;
		border-radius: 4px;
	}
	.c-detail {
		grid-column: 1 / -1;
		font-size: 11.5px;
		color: var(--fg3);
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
		line-height: 1.5;
	}
	.open-link {
		font-size: 12.5px;
	}
</style>
