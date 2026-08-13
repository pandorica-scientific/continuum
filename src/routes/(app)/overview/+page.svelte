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
		<div class="eyebrow-row">
			<Eyebrow emoji="🧩" label="What it is made of" />
			<span class="eyebrow-caption">red is what the bank still owns</span>
		</div>
		{#each data.composition.groups as g (g.label)}
			<div class="comp">
				<span class="c-label">{g.label}</span>
				<span class="mono c-numbers">
					{#if g.asset && g.liability}
						<span style="color: var(--fg2);">{g.asset}</span>
						<span style="color: var(--red);">{g.liability}</span>
						<span style:color="var({g.colorVar})">= {g.net}</span>
					{:else if g.liability}
						<span style="color: var(--red);">{g.liability}</span>
					{:else}
						<span style:color="var({g.colorVar})">{g.net}</span>
					{/if}
				</span>
				<div class="c-track">
					<div class="c-bar" style:width="{g.width}%">
						<div class="c-net" style:background="var({g.colorVar})"></div>
						{#if g.owedPct > 0}
							<div class="c-owed" style:width="{g.owedPct}%"></div>
						{/if}
					</div>
				</div>
				<span class="c-detail">{g.detail}</span>
			</div>
		{/each}
		<div class="net-line">
			<span class="c-label">Net worth</span>
			<span class="mono c-numbers">
				<span style="color: var(--fg2);">{data.composition.assetsTotal}</span>
				<span style="color: var(--red);">{data.composition.liabilitiesTotal}</span>
				<span
					class="net-value"
					style:color={data.composition.netPositive ? 'var(--green)' : 'var(--red)'}
				>
					= {data.composition.net}
				</span>
			</span>
		</div>
	</div>

	<div class="card stack">
		<div class="eyebrow-row">
			<Eyebrow emoji="📅" label="Next 30 days" />
			<a href="/calendar" class="open-link">Open calendar →</a>
		</div>
		{#each data.upcoming as u (u.date + u.label)}
			<div class="up-row">
				<span class="mono up-date">{u.date}</span>
				<span class="up-label">{u.label}</span>
				<span class="mono up-amount" style:color={u.negative ? 'var(--red)' : 'var(--green)'}>
					{u.amount ?? ''}
				</span>
			</div>
		{:else}
			<span class="quiet">Nothing on the books for the next month.</span>
		{/each}
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
	.c-numbers {
		font-size: 12.5px;
		text-align: right;
		display: flex;
		gap: 10px;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
	.c-track {
		grid-column: 1 / -1;
		height: 6px;
		background: var(--card3);
		border-radius: 4px;
		overflow: hidden;
	}
	.c-bar {
		position: relative;
		height: 100%;
		border-radius: 4px;
		overflow: hidden;
	}
	.c-net {
		position: absolute;
		inset: 0;
	}
	.c-owed {
		position: absolute;
		top: 0;
		right: 0;
		height: 100%;
		background: var(--red);
		opacity: 0.85;
	}
	.net-line {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 4px 12px;
		border-top: 1px solid var(--bd);
		padding-top: 12px;
	}
	.net-line .c-label {
		font-weight: 600;
		color: var(--fg1);
	}
	.net-value {
		font-weight: 600;
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
	.up-row {
		display: grid;
		grid-template-columns: 52px minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--bd);
	}
	.up-date {
		font-size: 12px;
		color: var(--fg3);
	}
	.up-label {
		font-size: 13.5px;
		color: var(--fg2);
	}
	.up-amount {
		font-size: 13px;
	}
	.open-link {
		font-size: 12.5px;
	}
</style>
