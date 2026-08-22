<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import Sankey from './Sankey.svelte';
	import { formatMinor, displayCurrency, fromMajor } from '$lib/money';
	import { signTone } from './tone';
	import type { FlowData } from '$lib/server/cashflow';

	let { flow, currency }: { flow: FlowData; currency: string } = $props();

	const fmt = (v: number) => formatMinor(fromMajor(v, currency), currency);
	const unit = $derived(displayCurrency(currency));
	// "In" is unsigned by construction. "Kept" is not: a month that spent more
	// than it earned reported its shortfall in the colour of a gain.
	const keptTone = $derived(signTone(flow.totals.kept));
</script>

<div class="card flow-card">
	<div class="totals">
		<div class="total">
			<span class="eyebrow" style="letter-spacing: 0.07em;">In</span>
			<span class="mono t-value" style="color: var(--green);"
				>{fmt(flow.totals.in)}<span class="t-unit">{unit}</span></span
			>
		</div>
		<div class="total">
			<span class="eyebrow" style="letter-spacing: 0.07em;">Out</span>
			<span class="mono t-value">{fmt(flow.totals.out)}<span class="t-unit">{unit}</span></span>
		</div>
		<div class="total">
			<span class="eyebrow" style="letter-spacing: 0.07em;">Kept</span>
			<span class="mono t-value" style:color="var({keptTone})"
				>{fmt(flow.totals.kept)}<span class="t-unit">{unit}</span></span
			>
		</div>
	</div>

	{#if flow.totals.in > 0}
		<Sankey
			flow={{
				sources: flow.input.sources,
				stages: flow.input.stages,
				remainderLabel: flow.input.remainderLabel,
				kept: flow.totals.kept,
				breakdown: flow.breakdown
			}}
			{currency}
		/>
	{:else}
		<p class="empty">The waterfall appears once income lands in the selected period.</p>
	{/if}

	<div class="breakdown">
		{#each flow.breakdown as g (g.key)}
			<div class="b-group">
				<div class="b-head">
					<span class="b-dot" style:background="var({g.colorVar})"></span>
					<span class="b-label">{g.label}</span>
					<span class="mono b-pct">{g.pct}%</span>
				</div>
				{#each g.leaves as leaf (leaf.name)}
					{#if !(g.leaves.length === 1 && leaf.name === g.label)}
						<div class="b-leaf">
							<span>{leaf.name}</span>
							<span class="mono">{fmt(leaf.value)}</span>
						</div>
					{/if}
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.flow-card {
		padding: 18px 20px 20px;
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.totals {
		display: flex;
		gap: 14px 28px;
		flex-wrap: wrap;
		align-items: baseline;
	}
	.total {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.t-value {
		font-size: var(--text-2xl);
		font-weight: 600;
		white-space: nowrap;
	}
	.t-unit {
		font-size: var(--text-sm);
		color: var(--fg3);
		margin-left: 5px;
	}
	.empty {
		margin: 0;
		padding: 40px 0;
		text-align: center;
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.breakdown {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(174px, 1fr));
		gap: 16px 22px;
		border-top: 1px solid var(--bd);
		padding-top: 15px;
		margin-top: 4px;
	}
	.b-group {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.b-head {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.b-dot {
		width: 9px;
		height: 9px;
		border-radius: 3px;
		flex: 0 0 auto;
	}
	.b-label {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--fg1);
	}
	.b-pct {
		font-size: var(--text-xs);
		color: var(--fg3);
		margin-left: auto;
	}
	.b-leaf {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: var(--space-6);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
