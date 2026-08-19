<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// Interest vs principal per year, stacked: green is what leaves the debt,
	// orange is what the bank keeps. Bars only reach as far as known rates.
	interface YearBar {
		year: string;
		interest: number;
		principal: number;
		interestLabel: string;
		principalLabel: string;
	}
	let { years, currency }: { years: YearBar[]; currency: string } = $props();

	const W = 820;
	const H = 190;
	const PAD = { top: 10, bottom: 22, left: 4, right: 4 };

	const max = $derived(Math.max(1, ...years.map((y) => y.interest + y.principal)));
	const innerW = W - PAD.left - PAD.right;
	const innerH = H - PAD.top - PAD.bottom;
	const slot = $derived(innerW / Math.max(1, years.length));
	const barW = $derived(Math.min(46, slot * 0.72));
	// label every bar when there is room, else thin out to every nth year
	const labelEvery = $derived(Math.max(1, Math.ceil(years.length / 14)));
</script>

<div class="wrap">
	<svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet">
		{#each years as y, i (y.year)}
			{@const x = PAD.left + i * slot + (slot - barW) / 2}
			{@const hPrincipal = (y.principal / max) * innerH}
			{@const hInterest = (y.interest / max) * innerH}
			{@const yTop = PAD.top + innerH - hPrincipal - hInterest}
			<g>
				<title
					>{y.year} · interest {y.interestLabel}
					{currency} · principal {y.principalLabel}
					{currency}</title
				>
				<rect {x} y={yTop} width={barW} height={hInterest} class="interest" rx="2" />
				<rect {x} y={yTop + hInterest} width={barW} height={hPrincipal} class="principal" rx="2" />
				{#if i % labelEvery === 0}
					<text x={x + barW / 2} y={H - 6} class="mono year">{y.year}</text>
				{/if}
			</g>
		{/each}
	</svg>
	<div class="legend">
		<span class="key"><span class="dot interest-dot"></span>Interest — the bank keeps it</span>
		<span class="key"><span class="dot principal-dot"></span>Principal — reduces the debt</span>
	</div>
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	svg {
		width: 100%;
		display: block;
	}
	.interest {
		fill: var(--orange);
	}
	.principal {
		fill: var(--green);
	}
	.year {
		font-size: 10.5px;
		fill: var(--fg3);
		text-anchor: middle;
	}
	.legend {
		display: flex;
		gap: 18px;
		flex-wrap: wrap;
	}
	.key {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 11.5px;
		color: var(--fg3);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 3px;
	}
	.interest-dot {
		background: var(--orange);
	}
	.principal-dot {
		background: var(--green);
	}
</style>
