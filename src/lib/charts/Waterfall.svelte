<script lang="ts">
	import { buildWaterfall, W, H, type WaterfallInput } from './waterfall';
	import { formatMinor, fromMajor } from '$lib/money';

	let { input, currency }: { input: WaterfallInput; currency: string } = $props();

	// The chart is laid out once at this size and then scaled to whatever room
	// its panel gives it. It used to be a fixed 592px box that scrolled
	// horizontally below 880px, which cannot work now that the flow panel is
	// resizable to a quarter of the board.
	const BASE_W = 880;
	const BASE_H = 592;
	const MIN_SCALE = 0.18;

	const layout = $derived(buildWaterfall(input));

	let outer = $state<HTMLDivElement | null>(null);
	let scale = $state(1);

	function fit(width: number) {
		// A zero width means the element is not laid out at all; keep the last
		// good scale rather than collapsing the chart to nothing.
		if (width > 0) scale = Math.min(1, Math.max(MIN_SCALE, width / BASE_W));
	}

	// Above the base width the chart stretches instead of scaling, as it always
	// did: the SVG has preserveAspectRatio="none" and the labels are positioned
	// in percentages, so it fills the room without inflating type. Scaling up
	// would grow the labels past their designed sizes; capping the scale at 1
	// and leaving the box at 880px — which is what shipped — simply left dead
	// space to the right of a full-width Flow panel.
	const stretched = $derived(scale >= 1);

	$effect(() => {
		const element = outer;
		if (!element) return;

		// Measure synchronously as soon as the ref attaches. ResizeObserver never
		// fires in a hidden document, so an observer-only implementation renders
		// the chart unscaled and clipped in a background tab — leave the observer
		// to handle later resizes only.
		fit(element.getBoundingClientRect().width);

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) fit(entry.contentRect.width);
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	const pct = (v: number, total: number) => `${(v / total) * 100}%`;

	function amountText(amount: number): string {
		return formatMinor(fromMajor(amount, currency), currency);
	}
</script>

<!-- The outer box takes the scaled height so nothing dead sits beneath it. -->
<div class="chart-fit" bind:this={outer} style:height="{BASE_H * scale}px">
	<div
		class="chart-inner"
		style:width={stretched ? '100%' : `${BASE_W}px`}
		style:height="{BASE_H}px"
		style:transform={stretched ? 'none' : `scale(${scale})`}
	>
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
	.chart-fit {
		position: relative;
		width: 100%;
		overflow: hidden;
	}
	.chart-inner {
		position: relative;
		transform-origin: top left;
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
