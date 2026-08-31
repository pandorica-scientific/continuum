<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import {
		buildSankey,
		estimateText,
		type MeasureText,
		type SankeyNode,
		type SankeyRibbon
	} from './sankey';
	import { depthFor, flowGraph, type FlowGraphInput } from './flow-graph';
	import { formatMinor, fromMajor } from '$lib/money';

	let { flow, currency }: { flow: FlowGraphInput; currency: string } = $props();

	// The diagram's own name and description are referenced by id, and a screen
	// can hold two of these — the overview panel and the cash-flow page — so the
	// ids cannot be written out. Svelte's own is consistent across hydration,
	// which a counter of ours would not be.
	const uid = $props.id();

	/** Room for four columns of labels without them touching. */
	const MIN_HEIGHT = 260;
	const MAX_HEIGHT = 620;

	/**
	 * How solid a ribbon is drawn: on its own, when it touches the band being
	 * read, and when it does not.
	 *
	 * The question a Sankey answers is "where did THIS go", and a dozen bands at
	 * one weight cannot answer it — the eye loses a band the moment it crosses
	 * another. Lighting the flows that touch one block and pushing the rest back
	 * is what makes the answer a matter of looking. The dim is deep enough to
	 * recede and not so deep that the shape of the whole diagram goes with it.
	 */
	const RIBBON_OPACITY = 0.45;
	const RIBBON_LIT = 0.7;
	const RIBBON_DIM = 0.12;

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

	/**
	 * Text measured in the faces it will actually be drawn in.
	 *
	 * A canvas measures the same string the same way the page lays it out, which
	 * is what makes a label's box agree with its label on every machine. The
	 * families come from the tokens rather than being written out here, so a
	 * change to either is followed rather than copied.
	 */
	function canvasMeasure(element: HTMLElement): MeasureText {
		const context = document.createElement('canvas').getContext('2d');
		if (!context) return estimateText;
		const style = getComputedStyle(element);
		const sans = style.getPropertyValue('--font-sans');
		const mono = style.getPropertyValue('--font-mono');
		return (text, font, kind) => {
			// 500 is `.name`'s weight and 400 the value's; a variable face is
			// genuinely wider at the heavier one.
			context.font = kind === 'value' ? `400 ${font}px ${mono}` : `500 ${font}px ${sans}`;
			return context.measureText(text).width;
		};
	}

	/**
	 * Replaced once the real faces are in, which lays the diagram out again.
	 *
	 * Until a webfont arrives the browser draws in a fallback that is WIDER than
	 * Inter, and which fallback it is depends on the operating system. A layout
	 * measured then is right for what is on screen at that moment and wrong a
	 * moment later — so it is measured again when the swap happens. Nothing else
	 * would trigger that: the panel is still exactly as wide as it was.
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

	// The diagram is laid out in the box's own pixels, so labels stay the size
	// they were designed at however wide the panel is. Height follows width so
	// the ribbons keep a readable slope rather than flattening.
	const height = $derived(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, width * 0.46)));
	const layout = $derived(
		width > 0
			? buildSankey(flowGraph(flow, depthFor(width)), { width, height }, measure)
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
	 * What the reader is on, and where to say it.
	 *
	 * A label is drawn permanently only where the band has room for one. The rest
	 * are reachable by hovering — and, since every band that leads to rows is a
	 * link, by tabbing — which is what lets a crowded diagram stay readable
	 * without hiding what it holds. The breakdown strip beneath the chart stays
	 * for touch, where there is no hover at all.
	 */
	let hovered = $state<{ label: string; value: number; x: number; y: number } | null>(null);

	/**
	 * Which block the reader is on, or null for none.
	 *
	 * Every ribbon that touches it is drawn solid and the rest recede, so a flow
	 * can be followed across four columns by looking rather than by tracing.
	 */
	let hoveredKey = $state<string | null>(null);

	/**
	 * Or which single band, when the reader is on the flow itself rather than on
	 * a block it joins.
	 *
	 * Held apart from `hoveredKey` because the two answer different questions —
	 * "everything touching this block" and "this one band" — and only one of them
	 * can be being asked at a time. Whichever is set decides; a band under the
	 * pointer lights itself alone, which is the finer of the two answers and the
	 * one a reader is asking for by pointing at the flow rather than at its end.
	 */
	let hoveredRibbon = $state<number | null>(null);

	/** Names by key, because a ribbon's tooltip has to say both of its ends. */
	const labelOf = $derived(new Map(layout.nodes.map((node) => [node.key, node.label])));

	/**
	 * Placed from the layout rather than from the element under the pointer.
	 *
	 * The geometry already knows where everything is, and a measured rect would
	 * have to be turned back into this box's coordinates by measuring the box as
	 * well. It is also what lets the keyboard and the mouse reach the same code:
	 * a focused band has no pointer event to take a rect from.
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

	const ribbonOpacity = (ribbon: SankeyRibbon, index: number) => {
		if (hoveredRibbon !== null) return index === hoveredRibbon ? RIBBON_LIT : RIBBON_DIM;
		if (hoveredKey === null) return RIBBON_OPACITY;
		return ribbon.from === hoveredKey || ribbon.to === hoveredKey ? RIBBON_LIT : RIBBON_DIM;
	};
</script>

<!-- The block itself, without the wrapper that gives it its meaning: a link
     where there are rows behind it, and a plain labelled figure where there are
     not. Drawing it once keeps the two wrappers to what actually differs. -->
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
		<!-- Named and described rather than announced as one image: "Where the
		     money goes" alone tells a reader the picture exists and nothing about
		     what is in it, and the blocks below each carry their own figure. -->
		<svg width={layout.width} height={layout.height} aria-labelledby="{uid}-title {uid}-desc">
			<title id="{uid}-title">Where the money goes</title>
			<desc id="{uid}-desc">
				What came in on the left, splitting across the groups it went to and whatever was left.
				Every band is listed with its own figure in the breakdown beneath the chart.
			</desc>
			<!-- The bands carry no name of their own: what one says is said by the
			     two blocks it joins, and both are in the reading order already. So
			     they are skipped rather than read out as a run of unnamed shapes,
			     and the figure along one is on hover. -->
			{#each layout.ribbons as ribbon, i (i)}
				<path
					d={ribbon.d}
					fill="var({ribbon.colorVar})"
					fill-opacity={ribbonOpacity(ribbon, i)}
					aria-hidden="true"
					onpointerenter={() => enterRibbon(ribbon, i)}
					onpointerleave={leave}
				/>
			{/each}
			<!-- A band stands for rows the register can list, so where there are rows
			     the block is a link to them. The wrapper carries the name and the
			     figure, because that is what a reader is following; the rect inside
			     it says nothing, or a screen reader would read the band twice. The
			     handlers sit on the wrapper for the same reason — the tooltip
			     follows whatever the reader is actually on.

			     Only the links take focus. A residual — cash kept, money drawn from
			     reserves — is arithmetic on the rest and leads nowhere, and its
			     figure is in the totals row under the chart, so tabbing through it
			     would be a stop that offers nothing. -->
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
	/* Only the bands that lead somewhere say so. A residual — cash kept, money
	   taken from reserves — is arithmetic on the rest and has no rows behind it,
	   so it stays as it was rather than inviting a click that goes nowhere. */
	a .node {
		cursor: pointer;
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
	/* The engine measures every name in the face it is drawn in and drops one it
	   cannot fit whole, so this is a backstop rather than the mechanism: it keeps
	   a name inside its box in the one frame between a webfont arriving and the
	   relayout that follows it. */
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
