<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';
	import { lineGeometry, type BarSlot, type LineSeries } from './line';

	/**
	 * Lines over slots, optionally with stacked bars above them, drawn at real
	 * pixel sizes.
	 *
	 * It measures its own box rather than scaling a fixed viewBox, which is what
	 * the charts it replaces did. The difference matters: a scaled viewBox
	 * stretches the stroke and the type with the width, so the same chart came
	 * out with a 2px line on a monitor and a 5px line on a phone — and its axis
	 * labels had to be positioned as HTML in percentages on top of the SVG,
	 * because text inside it scaled too.
	 *
	 * The bars are here rather than in a second component because the salary and
	 * tax charts have always drawn both at once: money on top at its own scale,
	 * a percentage line beneath at its own. Splitting them would mean two
	 * components that have to agree on a slot pitch, a hover target and a
	 * readout position, which is the drift this codebase keeps paying for.
	 *
	 * Every decision about WHERE something goes is in `line.ts`, which has no
	 * DOM in it and a test beside it. This file is the markup over that.
	 */
	interface Props {
		series: LineSeries[];
		/** Stacked bars, one slot each, drawn in their own band above the lines. */
		bars?: BarSlot[];
		/** How much of the plot the bars get, 0–1. Ignored when there are none. */
		barShare?: number;
		/** One per slot, under the plot. */
		labels?: string[];
		/** A second, quieter line under each label — a year under a month. */
		sublabels?: string[];
		height?: number;
		/** Turns a line-axis value into what is printed beside it. */
		format?: (value: number) => string;
		/** Turns a bar-axis value into what is printed beside it. */
		barFormat?: (value: number) => string;
		/** Printed sideways beside each band — "Thousands Kč", "Change". */
		axisTitle?: string;
		barAxisTitle?: string;
		/** Named for a screen reader, since the shape says nothing to one. */
		title: string;
		description?: string;
		/** Gradients and patterns the bars' `fill` refers to by `url(#id)`. */
		defs?: Snippet;
		/**
		 * The figures for the slot under the pointer.
		 *
		 * A snippet rather than a prop shape: what a salary year and a tax year
		 * have to say are different lists, and an engine that tried to describe
		 * both would end up describing neither.
		 */
		readout?: Snippet<[number]>;
		/** Keys and a footnote, under the chart. */
		legend?: Snippet;
		/** What each slot is called, for the hover target's accessible name. */
		slotLabel?: (index: number) => string;
	}

	let {
		series,
		bars = [],
		barShare = 0.7,
		labels = [],
		sublabels = [],
		height = 300,
		format = (v: number) => String(Math.round(v)),
		barFormat,
		axisTitle,
		barAxisTitle,
		title,
		description,
		defs,
		readout,
		legend,
		slotLabel
	}: Props = $props();

	let box = $state<HTMLDivElement | null>(null);
	let width = $state(0);
	let hover = $state<number | null>(null);

	$effect(() => {
		const element = box;
		if (!element) return;
		// Measured synchronously first: a ResizeObserver never fires in a hidden
		// document, so an observer-only version renders at zero width in a
		// background tab — the same trap `Sankey.svelte` documents.
		width = element.getBoundingClientRect().width;
		const observer = new ResizeObserver(([entry]) => {
			width = entry.contentRect.width;
		});
		observer.observe(element);
		return () => observer.disconnect();
	});

	const g = $derived(
		lineGeometry(series, width, height, {
			format,
			barFormat,
			bars,
			barShare: bars.length ? barShare : 0,
			maxBarWidth: 34
		})
	);

	// Flipped to the left of the guide for the later half, so the readout for
	// the last slot is not drawn off the edge of the card.
	const flip = $derived(hover !== null && hover >= g.slots.length / 2);
</script>

<div class="chart-wrap">
	<div class="chart" bind:this={box} style:height="{height}px">
		{#if width > 0}
			<svg {width} {height} role="img" aria-label={title}>
				{#if description}<desc>{description}</desc>{/if}
				{#if defs}<defs>{@render defs()}</defs>{/if}

				<!-- The bars' band first, so its gridlines sit under everything. -->
				{#each g.barTicks as tick (tick.value)}
					<line
						x1={g.plot.x}
						x2={g.plot.x + g.plot.w}
						y1={tick.y}
						y2={tick.y}
						stroke="var(--bd)"
						stroke-width="1"
					/>
					<text x={g.plot.x - 10} y={tick.y + 4} class="axis mono" text-anchor="end">
						{tick.label}
					</text>
				{/each}

				{#each g.ticks as tick (tick.value)}
					<line
						x1={g.plot.x}
						x2={g.plot.x + g.plot.w}
						y1={tick.y}
						y2={tick.y}
						stroke="var(--bd)"
						stroke-width="1"
					/>
					<text x={g.plot.x - 10} y={tick.y + 4} class="axis mono" text-anchor="end">
						{tick.label}
					</text>
				{/each}

				<!-- Only where the data crosses it, and heavier than a gridline: on a
				     chart that goes negative, zero is the only line that means something
				     other than "a round number". -->
				{#if g.zeroY !== null}
					<line
						x1={g.plot.x}
						x2={g.plot.x + g.plot.w}
						y1={g.zeroY}
						y2={g.zeroY}
						stroke="var(--bd2)"
						stroke-width="1"
					/>
				{/if}

				{#each g.bars as bar, i (i)}
					{#each bar.segments as seg, j (j)}
						<rect
							x={seg.x}
							y={seg.y}
							width={seg.w}
							height={seg.h}
							rx="3"
							fill={seg.fill}
							stroke={seg.stroke ?? 'none'}
							stroke-width={seg.stroke ? 1 : 0}
							class="bar"
							class:dim={hover !== null && hover !== i}
						/>
					{/each}
					{#if bar.tickY !== null}
						<line
							x1={bar.x}
							x2={bar.x + bar.w}
							y1={bar.tickY}
							y2={bar.tickY}
							stroke="var(--fg1)"
							stroke-width="2"
						/>
					{/if}
				{/each}

				<!-- The guide, drawn between the bars and the lines so it reads as
				     belonging to the whole column rather than to either band. -->
				{#if hover !== null && g.slots[hover] !== undefined}
					<line
						x1={g.slots[hover]}
						x2={g.slots[hover]}
						y1={g.plot.y}
						y2={g.plot.y + g.plot.h}
						stroke="var(--bd2)"
						stroke-width="1"
					/>
				{/if}

				{#each g.series as s (s.key)}
					{#each s.paths as d, i (i)}
						<path
							{d}
							fill="none"
							stroke="var({s.colorVar})"
							stroke-width="2.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-dasharray={s.dashed ? '5 5' : undefined}
						/>
					{/each}
					<!-- The ring is the page's own ground, so a point stays legible where
					     two series cross. -->
					{#each s.points as point, i (i)}
						<circle
							cx={point.x}
							cy={point.y}
							r="4.5"
							fill="var({s.colorVar})"
							stroke="var(--surface)"
							stroke-width="2"
						/>
					{/each}
					{#if s.end && s.endLabel}
						<text x={s.end.x + 12} y={s.end.y + 4} class="end mono" fill="var({s.colorVar})">
							{s.endLabel}
						</text>
					{/if}
				{/each}

				{#each g.slots as x, i (i)}
					{#if labels[i]}
						<text {x} y={g.plot.y + g.plot.h + 20} class="tick" text-anchor="middle">
							{labels[i]}
						</text>
					{/if}
					{#if sublabels[i]}
						<text {x} y={g.plot.y + g.plot.h + 33} class="subtick mono" text-anchor="middle">
							{sublabels[i]}
						</text>
					{/if}
				{/each}
			</svg>

			<!-- Axis titles as HTML: rotated SVG text cannot be selected, and these
			     are the two words that say what the numbers on the left ARE. -->
			{#if barAxisTitle && g.barTicks.length}
				<span
					class="axis-title"
					style:top="{((g.plot.y + (g.splitY - g.plot.y) / 2) / height) * 100}%"
					>{barAxisTitle}</span
				>
			{/if}
			{#if axisTitle}
				<span
					class="axis-title"
					style:top="{((g.splitY + (g.plot.y + g.plot.h - g.splitY) / 2) / height) * 100}%"
					>{axisTitle}</span
				>
			{/if}

			<!-- One target per slot, the width of the pitch. Buttons, not a single
			     mousemove handler: a keyboard reaches the figures by tabbing, and a
			     div with a pointer listener is nothing at all to a screen reader. -->
			{#if readout}
				{#each g.hits as hit, i (i)}
					<button
						type="button"
						class="hit"
						style:left="{(hit.x / width) * 100}%"
						style:width="{(hit.w / width) * 100}%"
						onmouseenter={() => (hover = i)}
						onmouseleave={() => (hover = null)}
						onfocus={() => (hover = i)}
						onblur={() => (hover = null)}
						aria-label={slotLabel?.(i) ?? `${labels[i] ?? i + 1} figures`}
					></button>
				{/each}

				{#if hover !== null}
					<div
						class="readout"
						class:flip
						style:left="{(g.slots[hover] / width) * 100}%"
						role="status"
					>
						{@render readout(hover)}
					</div>
				{/if}
			{/if}
		{/if}
	</div>
	{#if legend}
		<div class="legend">{@render legend()}</div>
	{/if}
</div>

<style>
	.chart-wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-width: 0;
	}
	/* Ruled off from the plot, the way the design draws it: the keys are a
	   caption on the picture above them, not another row of the panel. */
	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4) var(--space-7);
		border-top: 1px solid var(--bd);
		padding-top: var(--space-6);
	}
	.chart {
		position: relative;
		width: 100%;
		min-width: 0;
	}
	.axis {
		font-size: var(--text-xs);
		fill: var(--fg3);
	}
	.tick {
		font-size: var(--text-sm);
		font-weight: 500;
		fill: var(--fg2);
	}
	.subtick {
		font-size: var(--text-xs);
		fill: var(--fg3);
	}
	/* Beside the line rather than in a legend: matching a colour to a name in a
	   key is work the reader should not have to do twice per chart. */
	.end {
		font-size: var(--text-xs);
		font-weight: 600;
	}
	/* Everything but the column being read steps back, which is what makes a
	   twelve-year chart answerable by pointing at one year. */
	.bar {
		transition: opacity var(--dur) var(--ease);
	}
	.bar.dim {
		opacity: 0.45;
	}
	.axis-title {
		position: absolute;
		left: 0;
		transform: translate(-50%, -50%) rotate(-90deg);
		margin-left: 12px;
		font-size: var(--text-xs);
		color: var(--fg3);
		white-space: nowrap;
		pointer-events: none;
	}
	.hit {
		position: absolute;
		top: 0;
		bottom: 0;
		border: 0;
		background: none;
		padding: 0;
		cursor: default;
	}
	.hit:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: -2px;
	}
	/* Opaque, because it floats over the chart it describes — the rule
	   `design/opaque-floating-surface` enforces product-wide. */
	.readout {
		position: absolute;
		top: var(--space-6);
		transform: translateX(var(--shift, 10px));
		z-index: 2;
		min-width: 170px;
		padding: var(--space-5) var(--space-6);
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-tile);
		box-shadow: var(--shadow-float);
		font-size: var(--text-sm);
		pointer-events: none;
	}
	.readout.flip {
		--shift: calc(-100% - 10px);
	}
</style>
