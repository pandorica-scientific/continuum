<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import {
		buildSankey,
		estimateText,
		pathRibbons,
		ribbonRoute,
		type MeasureText,
		type SankeyNode,
		type SankeyRibbon
	} from './sankey';
	import { depthFor, flowGraph, type FlowGraphInput } from './flow-graph';
	import { formatMinor, fromMajor } from '$lib/money';

	let { flow, currency }: { flow: FlowGraphInput; currency: string } = $props();

	// Referenced by id, and a screen can hold two of these — ids can't be
	// hardcoded. Svelte's own id is consistent across hydration.
	const uid = $props.id();

	/** Room for four columns of labels without them touching. */
	const MIN_HEIGHT = 260;
	const MAX_HEIGHT = 620;

	/**
	 * How solid a ribbon is drawn: on its own, when it touches the band being
	 * read, and when it does not. Dimming the rest is what lets a reader follow
	 * one flow through a dozen crossing bands.
	 */
	const RIBBON_OPACITY = 0.45;
	const RIBBON_LIT = 0.7;
	const RIBBON_DIM = 0.12;

	let box = $state<HTMLDivElement | null>(null);
	let width = $state(0);

	$effect(() => {
		const element = box;
		if (!element) return;

		// Measured synchronously first: ResizeObserver never fires in a hidden
		// document, so an observer-only version renders at zero width in a
		// background tab.
		width = element.getBoundingClientRect().width;

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) if (entry.contentRect.width > 0) width = entry.contentRect.width;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	/** Text measured in the faces it will actually be drawn in, so a label's box agrees with it on every machine. */
	function canvasMeasure(element: HTMLElement): MeasureText {
		const context = document.createElement('canvas').getContext('2d');
		if (!context) return estimateText;
		const style = getComputedStyle(element);
		const sans = style.getPropertyValue('--font-sans');
		const mono = style.getPropertyValue('--font-mono');
		return (text, font, kind) => {
			// 500 is `.name`'s weight, 400 the value's — a variable face is wider at the heavier one.
			context.font = kind === 'value' ? `400 ${font}px ${mono}` : `500 ${font}px ${sans}`;
			return context.measureText(text).width;
		};
	}

	/**
	 * Replaced once the real faces are in, which lays the diagram out again —
	 * the fallback face before a webfont arrives is wider than the real one, so
	 * the earlier layout is measured wrong and needs redoing on the swap.
	 */
	let measure = $state<MeasureText>(estimateText);
	$effect(() => {
		const element = box;
		if (!element) return;
		let live = true;
		measure = canvasMeasure(element);
		document.fonts?.ready.then(() => {
			if (live) measure = canvasMeasure(element);
		});
		return () => {
			live = false;
		};
	});

	// Height follows width so ribbons keep a readable slope rather than flattening.
	const height = $derived(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, width * 0.46)));
	const layout = $derived(
		width > 0
			? buildSankey(flowGraph(flow, depthFor(width)), { width, height }, measure)
			: { width: 0, height: MIN_HEIGHT, nodes: [], ribbons: [], labels: [] }
	);

	const amount = (value: number) => formatMinor(fromMajor(value, currency), currency);

	/** The joins between a name and its band, for names that couldn't stay level with one. */
	const leaders = $derived(
		layout.labels
			.filter((l) => l.fits && l.leader)
			.map((l) => ({ key: l.key, colorVar: l.colorVar, ...l.leader! }))
	);

	/**
	 * What the reader is on, and where to say it. Labels not drawn permanently
	 * are reachable by hovering/tabbing; the breakdown strip below covers touch.
	 */
	let hovered = $state<{ label: string; value: number; x: number; y: number } | null>(null);

	/** Which block the reader is on, or null. Every ribbon touching it lights; the rest recede. */
	let hoveredKey = $state<string | null>(null);

	/**
	 * Or which single band, when the reader is on the flow itself. Held apart
	 * from `hoveredKey` since only one of the two questions applies at a time.
	 */
	let hoveredRibbon = $state<number | null>(null);

	/** Names by key, because a ribbon's tooltip has to say both of its ends. */
	const labelOf = $derived(new Map(layout.nodes.map((node) => [node.key, node.label])));

	/**
	 * Placed from the layout rather than the element under the pointer, so
	 * keyboard focus and pointer hover reach the same code — a focused band has
	 * no pointer event to take a rect from.
	 */
	function show(label: string, value: number, x: number, y: number) {
		hovered = { label, value, x, y };
	}

	/** A block: above its top edge, centred on it. */
	function enterNode(node: SankeyNode) {
		hoveredKey = node.key;
		show(node.label, node.value, node.x + node.w / 2, node.y);
	}

	/** A ribbon: at the middle of its run, on its own centre line. */
	function enterRibbon(ribbon: SankeyRibbon, index: number) {
		hoveredRibbon = index;
		show(
			`${labelOf.get(ribbon.from) ?? ribbon.from} → ${labelOf.get(ribbon.to) ?? ribbon.to}`,
			ribbon.value,
			(ribbon.x0 + ribbon.x1) / 2,
			(ribbon.y0 + ribbon.y1) / 2 + ribbon.thickness / 2
		);
	}

	function leave() {
		hovered = null;
		hoveredKey = null;
		hoveredRibbon = null;
	}

	/** The whole route through the block being read, not only what touches it. See `pathRibbons`. */
	const litPath = $derived(
		hoveredRibbon !== null
			? ribbonRoute(layout.ribbons, hoveredRibbon)
			: pathRibbons(layout.ribbons, hoveredKey)
	);
	const reading = $derived(hoveredRibbon !== null || hoveredKey !== null);

	const ribbonOpacity = (index: number) => {
		if (!reading) return RIBBON_OPACITY;
		return litPath.has(index) ? RIBBON_LIT : RIBBON_DIM;
	};

	const isLit = (index: number) => reading && litPath.has(index);

	/** One gradient per colour, not per band — bands sharing a colour share a definition. */
	const gradients = $derived([...new Set(layout.ribbons.map((r) => r.colorVar))]);
	const gradientId = (colorVar: string) => `${uid}-flow-${colorVar.replace(/[^a-z0-9]/gi, '')}`;
</script>

<!-- The block itself; the wrapper (link vs. labelled figure) is what differs. -->
{#snippet block(node: SankeyNode)}
	<rect
		x={node.x}
		y={node.y}
		width={node.w}
		height={node.h}
		rx="2"
		fill="var({node.colorVar})"
		class="node"
	/>
{/snippet}

<div class="sankey" bind:this={box} style:height="{height}px">
	{#if layout.nodes.length}
		<svg width={layout.width} height={layout.height} aria-labelledby="{uid}-title {uid}-desc">
			<title id="{uid}-title">Where the money goes</title>
			<desc id="{uid}-desc">
				What came in on the left, splitting across the groups it went to and whatever was left.
				Every band is listed with its own figure in the breakdown beneath the chart.
			</desc>
			<!-- Bands carry no name of their own — the two blocks they join say it — so they're aria-hidden. -->
			<defs>
				{#each gradients as colorVar (colorVar)}
					<linearGradient id={gradientId(colorVar)} x1="0" y1="0" x2="1" y2="0">
						<stop offset="0" stop-color="var({colorVar})" stop-opacity="0.22" />
						<stop offset="1" stop-color="var({colorVar})" stop-opacity="0.62" />
					</linearGradient>
				{/each}
			</defs>
			{#each layout.ribbons as ribbon, i (i)}
				<path
					d={ribbon.d}
					fill="url(#{gradientId(ribbon.colorVar)})"
					opacity={ribbonOpacity(i)}
					class="ribbon"
					class:lit={isLit(i)}
					class:alt={i % 2 === 1}
					aria-hidden="true"
					onpointerenter={() => enterRibbon(ribbon, i)}
					onpointerleave={leave}
				/>
			{/each}
			<!-- The wrapper (not the rect) carries the name/figure so a screen reader
			     doesn't read the band twice. Only links take focus — a residual
			     (cash kept, reserves drawn) leads nowhere and isn't worth a tab stop. -->
			{#each layout.nodes as node (node.key)}
				{#if node.href}
					<a
						href={node.href}
						aria-label="{node.label}: {amount(node.value)}"
						onpointerenter={() => enterNode(node)}
						onpointerleave={leave}
						onfocus={() => enterNode(node)}
						onblur={leave}
					>
						{@render block(node)}
					</a>
				{:else}
					<g
						role="img"
						aria-label="{node.label}: {amount(node.value)}"
						onpointerenter={() => enterNode(node)}
						onpointerleave={leave}
					>
						{@render block(node)}
					</g>
				{/if}
			{/each}
			{#each leaders as leader (leader.key)}
				<line
					x1={leader.x1}
					y1={leader.y1}
					x2={leader.x2}
					y2={leader.y2}
					class="leader"
					stroke="var({leader.colorVar})"
					aria-hidden="true"
				/>
			{/each}
		</svg>
		<!-- What a crowded column still can't fit is on hover and in the breakdown strip. -->
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
	.ribbon {
		transition: opacity var(--dur) var(--ease);
	}
	/* The flame: a lit band breathes slightly, on two offset cycles so a run of
	   bands doesn't pulse in lockstep (which would read as a loading state). */
	.ribbon.lit {
		animation: v2-flame-a 2.4s var(--ease) infinite;
	}
	.ribbon.lit.alt {
		animation-name: v2-flame-b;
		animation-duration: 3.1s;
	}
	@keyframes v2-flame-a {
		0%,
		100% {
			opacity: 0.7;
		}
		50% {
			opacity: 0.92;
		}
	}
	@keyframes v2-flame-b {
		0%,
		100% {
			opacity: 0.78;
		}
		45% {
			opacity: 1;
		}
	}
	/* app.css collapses animations to 1ms; without this a lit band would freeze mid-frame. */
	@media (prefers-reduced-motion: reduce) {
		.ribbon.lit,
		.ribbon.lit.alt {
			animation: none;
		}
	}

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
	a .node {
		cursor: pointer;
	}
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
	}
	/* Absolutely positioned in the diagram's pixel space, at the column's settled type size. */
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
	/* Middle-column names are drawn over the flow; the plate lifts them off a saturated band. */
	.label.plate {
		background: var(--plate);
		border-radius: var(--radius-sm);
		padding: 0 5px;
	}
	.leader {
		stroke-width: 1;
		opacity: 0.5;
	}
	/* Backstop, not the mechanism: covers the one frame between a webfont arriving and relayout. */
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
