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
		</svg>
		<!-- Only where there is room. The rest are on hover, and every one of them
		     is in the breakdown strip beneath the chart regardless — which is what
		     a touch device reads instead. -->
		{#each layout.labels.filter((l) => l.fits) as label (label.key)}
			<div
				class="label {label.anchor}"
				style:left="{label.x}px"
				style:top="{label.y}px"
				style:height="{label.height}px"
			>
				<span class="name">{label.label}</span>
				<span class="value mono">{amount(label.value)}</span>
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
	/* Labels sit outside their node, name over value, as a printed Sankey does.
	   Absolutely positioned in the same pixel space as the diagram, so they are
	   never scaled with it. */
	.label {
		position: absolute;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 1px;
		pointer-events: none;
		white-space: nowrap;
		/* Labels sit over the ribbons they describe, so they carry the halo
		   plate the design system keeps for exactly this. A text-shadow alone
		   is not enough over a saturated band. */
		background: var(--plate);
		border-radius: var(--radius-sm);
		padding: 3px 7px;
	}
	.label.end {
		transform: translateX(-100%);
		align-items: flex-end;
	}
	/* Centred on its node rather than starting at it: a middle column has ribbons
	   on both sides, so the label sits above the band it names. */
	.label.middle {
		align-items: center;
		transform: translateX(-50%);
	}
	.name {
		font-size: var(--text-sm);
		font-weight: 500;
		color: var(--fg1);
		line-height: 1.25;
	}
	.value {
		font-size: var(--text-xs);
		color: var(--fg2);
		line-height: 1.2;
	}
</style>
