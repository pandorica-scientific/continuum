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
				/>
			{/each}
		</svg>
		{#each layout.labels as label (label.key)}
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
		border-radius: 6px;
		padding: 3px 7px;
	}
	.label.end {
		transform: translateX(-100%);
		align-items: flex-end;
	}
	.label.middle {
		align-items: flex-start;
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
