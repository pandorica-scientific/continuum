<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { buildSankey } from './sankey';
	import { depthFor, flowGraph, type FlowGraphInput } from './flow-graph';
	import { formatMinor, fromMajor } from '$lib/money';

	let { flow, currency }: { flow: FlowGraphInput; currency: string } = $props();

	/** Room for four columns of labels without them touching. */
	const MIN_HEIGHT = 260;
	const MAX_HEIGHT = 620;

	let box = $state<HTMLDivElement | null>(null);
	let width = $state(0);

	$effect(() => {
		const element = box;
		if (!element) return;

		// Measured synchronously as soon as the ref attaches: ResizeObserver
		// never fires in a hidden document, so an observer-only version renders
		// at zero width in a background tab.
		width = element.getBoundingClientRect().width;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) if (entry.contentRect.width > 0) width = entry.contentRect.width;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	// The diagram is laid out in the box's own pixels, so labels stay the size
	// they were designed at however wide the panel is. Height follows width so
	// the ribbons keep a readable slope rather than flattening.
	const height = $derived(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, width * 0.46)));
	const layout = $derived(
		width > 0
			? buildSankey(flowGraph(flow, depthFor(width)), { width, height })
			: { width: 0, height: MIN_HEIGHT, nodes: [], ribbons: [], labels: [] }
	);

	const amount = (value: number) => formatMinor(fromMajor(value, currency), currency);

	/**
	 * The joins between a name and its band, for the names that could not stay
	 * level with one. Drawn inside the SVG so they sit under the ribbons' own
	 * edges rather than over the labels.
	 */
	const leaders = $derived(
		layout.labels
			.filter((l) => l.fits && l.leader)
			.map((l) => ({ key: l.key, colorVar: l.colorVar, ...l.leader! }))
	);

	/**
	 * What the pointer is over, and where to say it.
	 *
	 * A label is drawn permanently only where the band has room for one. The rest
	 * are reachable by hovering, which is what lets a crowded diagram stay
	 * readable without hiding what it holds. The breakdown strip beneath the chart
	 * stays for touch, where there is no hover at all.
	 */
	let hovered = $state<{ label: string; value: number; x: number; y: number } | null>(null);

	function show(event: PointerEvent, label: string, value: number) {
		const box = element(event)?.getBoundingClientRect();
		const host = box && element(event)?.closest('.sankey')?.getBoundingClientRect();
		if (!box || !host) return;
		hovered = { label, value, x: box.left - host.left + box.width / 2, y: box.top - host.top };
	}

	const element = (event: PointerEvent) =>
		event.currentTarget instanceof Element ? event.currentTarget : null;
</script>

<div class="sankey" bind:this={box} style:height="{height}px">
	{#if layout.nodes.length}
		<svg width={layout.width} height={layout.height} role="img" aria-label="Where the money goes">
			{#each layout.ribbons as ribbon, i (i)}
				<path d={ribbon.d} fill="var({ribbon.colorVar})" fill-opacity="0.45" />
			{/each}
			{#each layout.nodes as node (node.key)}
				<rect
					x={node.x}
					y={node.y}
					width={node.w}
					height={node.h}
					rx="2"
					fill="var({node.colorVar})"
					class="node"
					role="img"
					aria-label="{node.label}: {amount(node.value)}"
					onpointerenter={(e) => show(e, node.label, node.value)}
					onpointerleave={() => (hovered = null)}
				/>
			{/each}
			{#each leaders as leader (leader.key)}
				<line
					x1={leader.x1}
					y1={leader.y1}
					x2={leader.x2}
					y2={leader.y2}
					class="leader"
					stroke="var({leader.colorVar})"
				/>
			{/each}
		</svg>
		<!-- Each in the channel its column reserved, centred on the band it names.
		     A column shrinks its type to fit every name before it drops any; what
		     a very crowded one still cannot fit is on hover and in the breakdown
		     strip beneath the chart, which is what a touch device reads instead. -->
		{#each layout.labels.filter((l) => l.fits) as label (label.key)}
			<div
				class="label {label.anchor}"
				class:plate={label.plate}
				style:left="{label.x}px"
				style:top="{label.y}px"
				style:height="{label.height}px"
				style:font-size="{label.font}px"
				style:max-width="{label.width}px"
			>
				<span class="name">{label.label}</span>
				{#if label.showValue}<span class="value mono">{amount(label.value)}</span>{/if}
			</div>
		{/each}
		{#if hovered}
			<div class="tip" style:left="{hovered.x}px" style:top="{hovered.y}px" role="status">
				<span class="name">{hovered.label}</span>
				<span class="value mono">{amount(hovered.value)}</span>
			</div>
		{/if}
	{/if}
</div>

<style>
	.sankey {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
	}
	.node {
		cursor: default;
	}
	/* Above the plate a label uses, because it is answering a question somebody
	   is asking right now. */
	.tip {
		position: absolute;
		z-index: 2;
		transform: translate(-50%, calc(-100% - 6px));
		display: flex;
		flex-direction: column;
		gap: 1px;
		pointer-events: none;
		white-space: nowrap;
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-4);
		box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
	}
	/* Labels sit in the channel their column reserved, beside the band they name.
	   Absolutely positioned in the same pixel space as the diagram, and given the
	   type size that column settled on — so a crowded column reads smaller rather
	   than losing its names. No plate: nothing is drawn in a channel, so there is
	   nothing to lift the text off. */
	.label {
		position: absolute;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 1px;
		pointer-events: none;
	}
	.label.end {
		transform: translateX(-100%);
		align-items: flex-end;
		text-align: right;
	}
	.label.start {
		align-items: flex-start;
	}
	/* A middle column has ribbons on both sides of every band — its own leaving,
	   its parents' arriving — so there is no free space beside one to write in.
	   Those names are drawn over the flow, and the plate is what lifts them off
	   a saturated band; a text-shadow alone is not enough. */
	.label.plate {
		background: var(--plate);
		border-radius: var(--radius-sm);
		padding: 0 5px;
	}
	.leader {
		stroke-width: 1;
		opacity: 0.5;
	}
	/* The engine estimates text width without a DOM to measure in. Where the
	   estimate is beaten, the name is cut rather than allowed into the diagram. */
	.name,
	.value {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name {
		font-size: 1em;
		font-weight: 500;
		color: var(--fg1);
		line-height: 1.3;
	}
	.value {
		font-size: 0.85em;
		color: var(--fg2);
		line-height: 1.3;
	}
	.tip .name {
		font-size: var(--text-sm);
	}
	.tip .value {
		font-size: var(--text-xs);
	}
</style>
