<script lang="ts">
	import { buildWaterfall, W, H, type WaterfallInput } from './waterfall';
	import { formatMinor } from '$lib/money';

	let { input, currency }: { input: WaterfallInput; currency: string } = $props();

	const layout = $derived(buildWaterfall(input));

	const pct = (v: number, total: number) => `${(v / total) * 100}%`;

	function amountText(amount: number): string {
		return formatMinor(BigInt(Math.round(amount * 100)), currency);
	}
</script>

<div class="chart-scroll">
	<div class="chart-inner">
		<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none">
			{#each layout.paths as p, i (i)}
				<path d={p.d} fill="var({p.colorVar})" fill-opacity={p.opacity} />
			{/each}
			{#each layout.nodes as n, i (i)}
				<rect x={n.x} y={n.y} width="11" height={n.h} rx="2" fill="var({n.colorVar})" />
			{/each}
		</svg>
		{#each layout.labels as l, i (i)}
			<div
				class="wlabel {l.anchor}"
				class:stacked={l.stacked}
				style:left={pct(l.x, W)}
				style:top={pct(l.y, H)}
			>
				<span class="wname">{l.name}</span>
				<span class="wamount mono">{amountText(l.amount)}</span>
			</div>
		{/each}
	</div>
</div>

<style>
	.chart-scroll {
		position: relative;
		width: 100%;
		height: 592px;
		overflow-x: auto;
		overflow-y: hidden;
	}
	.chart-inner {
		position: relative;
		height: 100%;
		min-width: 880px;
		margin-right: 14px;
	}
	svg {
		width: 100%;
		height: 100%;
		display: block;
	}
	.wlabel {
		position: absolute;
		display: flex;
		align-items: baseline;
		gap: 7px;
		pointer-events: none;
		transform: translateY(-50%);
		white-space: nowrap;
	}
	.wlabel.right {
		transform: translate(-100%, -50%);
	}
	.wlabel.center {
		transform: translate(-50%, -50%);
	}
	.wlabel.stacked {
		flex-direction: column;
		align-items: center;
		gap: 0;
	}
	.wname {
		font-size: 12.5px;
		font-weight: 500;
		color: var(--fg1);
		text-shadow:
			0 0 8px var(--bg),
			0 0 8px var(--bg),
			0 0 4px var(--bg),
			0 0 2px var(--bg);
	}
	.wamount {
		font-size: 11px;
		color: var(--fg2);
		text-shadow:
			0 0 8px var(--bg),
			0 0 8px var(--bg),
			0 0 4px var(--bg),
			0 0 2px var(--bg);
	}
</style>
