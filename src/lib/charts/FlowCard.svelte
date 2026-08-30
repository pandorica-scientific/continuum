<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import Sankey from './Sankey.svelte';
	import Delta from './Delta.svelte';
	import { KEPT_KEY, ROUNDING } from './flow-graph';
	import { formatMinor, displayCurrency, fromMajor } from '$lib/money';
	import { signTone } from './tone';
	import type { FlowData } from '$lib/server/cashflow';

	let { flow, currency }: { flow: FlowData; currency: string } = $props();

	const fmt = (v: number) => formatMinor(fromMajor(v, currency), currency);
	const unit = $derived(displayCurrency(currency));
	// "In", "Out" and "Saved" are magnitudes by construction. "Kept" is not: a
	// month that spent more than it earned reported its shortfall in the colour
	// of a gain.
	const keptTone = $derived(signTone(flow.totals.kept));

	/**
	 * Which direction is the good news, for each of the four totals.
	 *
	 * Spending more is the only one where the arrow up is the bad answer, and it
	 * is written down here rather than inferred from the sign because nothing in
	 * the number itself says which kind of figure it is.
	 */
	const GOOD_WHEN_UP: Record<keyof FlowData['totals'], boolean> = {
		in: true,
		out: false,
		saved: true,
		kept: true
	};

	const stageByKey = $derived(new Map(flow.input.stages.map((stage) => [stage.key, stage])));

	/**
	 * What a head of the breakdown strip is compared against — null when there is
	 * no window behind this one to compare it with.
	 *
	 * The previous window's figures are looked up by the key the head is drawn
	 * under, so a group and its comparison are the same group by construction.
	 * A group the window before did not touch comes back as zero, which is a
	 * comparison the arithmetic itself declines to make.
	 */
	function versus(key: string) {
		const previous = flow.previous;
		if (!previous) return null;
		const stage = stageByKey.get(key);
		if (stage)
			return {
				current: stage.amount,
				previous: previous.byGroupKey[key] ?? 0,
				// Putting more aside is good news; spending more is not.
				goodWhenUp: stage.role === 'savings',
				against: previous.caption
			};

		// Anything that is not a stage is the row closing the strip: the cash the
		// window kept, drawn as a shortfall when it kept none. A shortfall is
		// compared as the magnitude it is drawn as, and against the window
		// before's own shortfall — which is a negative `kept`, so a window that
		// ended in the black leaves nothing to compare against.
		//
		// Tested against the same dust threshold the loader chose the head with,
		// and not against zero: a hundredth of a crown short is drawn as "Kept in
		// cash" up there, and a comparison that read it as a shortfall would
		// negate both sides of a row the strip had already called a surplus.
		const shortfall = flow.totals.kept < -ROUNDING;
		const sign = shortfall ? -1 : 1;
		return {
			current: sign * flow.totals.kept,
			previous: sign * (previous.byGroupKey[KEPT_KEY] ?? 0),
			goodWhenUp: !shortfall,
			against: previous.caption
		};
	}
</script>

{#snippet total(name: string, key: keyof FlowData['totals'], color: string | undefined)}
	<div class="total">
		<span class="eyebrow" style="letter-spacing: 0.07em;">{name}</span>
		<span class="t-line">
			<span class="mono t-value" style:color
				>{fmt(flow.totals[key])}<span class="t-unit">{unit}</span></span
			>
			{#if flow.previous}
				<Delta
					current={flow.totals[key]}
					previous={flow.previous.totals[key]}
					goodWhenUp={GOOD_WHEN_UP[key]}
					against={flow.previous.caption}
				/>
			{/if}
		</span>
	</div>
{/snippet}

<div class="card flow-card">
	<div class="head">
		<div class="totals">
			{@render total('In', 'in', 'var(--green)')}
			{@render total('Out', 'out', undefined)}
			{@render total('Saved', 'saved', 'var(--green)')}
			{@render total('Kept', 'kept', `var(${keptTone})`)}
		</div>
		<!--
			Said once, under the row, rather than on every arrow: the card carries a
			delta on every total and every group head, and repeating the window on
			each of them would crowd out the figures they are about.
		-->
		{#if flow.previous}
			<span class="against">against {flow.previous.caption}</span>
		{/if}
	</div>

	{#if flow.totals.in > 0}
		<Sankey
			flow={{ ...flow.input, kept: flow.totals.kept, breakdown: flow.breakdown }}
			{currency}
		/>
	{:else}
		<p class="empty">The waterfall appears once income lands in the selected period.</p>
	{/if}

	<div class="breakdown">
		{#each flow.breakdown as g (g.key)}
			{@const change = versus(g.key)}
			<div class="b-group">
				<div class="b-head">
					<span class="b-dot" style:background="var({g.colorVar})"></span>
					<span class="b-label">{g.label}</span>
					{#if change}<Delta {...change} />{/if}
					<span class="mono b-pct">{g.pct}%</span>
				</div>
				{#each g.leaves as leaf (leaf.key)}
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
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
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
	.t-line {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
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
	.against {
		font-size: var(--text-xs);
		color: var(--fg3);
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
