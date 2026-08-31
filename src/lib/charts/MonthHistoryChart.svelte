<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Every month on record, earned against spent.
	//
	// It used to be a row of CSS divs with a `title` attribute on each pair: no
	// axis at all, so a bar's height could be compared with its neighbour and
	// with nothing else, and the only way to read a figure was to rest on it and
	// wait for the browser's tooltip. This is the same data in the language the
	// Tax and Salary charts already speak — see tax-chart-geometry.ts for the
	// three SVG facts that govern all three (var() in attributes, the
	// letterboxed viewBox, HTML axis labels).
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import { compactAxis, displayCurrency, formatMinor, fromMajor } from '$lib/money';
	import {
		AXIS_TITLE_PCT,
		AXIS_Y,
		BOTTOM,
		GRID_FRACTIONS,
		TOP,
		VIEW_H,
		axisTicks,
		barsFor,
		ceilingFor,
		keptPct,
		type MonthBar
	} from '$lib/charts/month-history-geometry';
	import { VIEW_W, X_LEFT, X_RIGHT, slotFor } from '$lib/charts/plot';

	let {
		months,
		currency,
		savedRate,
		negativeMonths
	}: {
		months: MonthBar[];
		currency: string;
		/** Percentage of everything earned that was kept, over the whole record. */
		savedRate: number;
		negativeMonths: number;
	} = $props();

	let hover = $state<number | null>(null);

	const ceiling = $derived(ceilingFor(months));
	const ticks = $derived(axisTicks(months.map((m) => m.month)));

	// Labels come from compactAxis rather than per-tick formatting: at some
	// magnitudes whole thousands collapse and two gridlines read the same.
	const grid = $derived.by(() => {
		const values = GRID_FRACTIONS.map((f) => fromMajor(ceiling * f, currency));
		const labels = compactAxis(values, currency);
		return GRID_FRACTIONS.map((fraction, i) => ({
			fraction,
			y: BOTTOM - fraction * (BOTTOM - TOP),
			label: labels[i]
		}));
	});

	const axisUnit = $derived.by(() => {
		const symbol = displayCurrency(currency);
		if (ceiling >= 1_000_000) return `Millions ${symbol}`;
		if (ceiling >= 1_000) return `Thousands ${symbol}`;
		return symbol;
	});

	const hovered = $derived(hover === null ? null : (months[hover] ?? null));
	const flip = $derived(hover !== null && hover >= months.length / 2);

	const money = (major: number) => formatMinor(fromMajor(major, currency), currency);
	const unit = $derived(displayCurrency(currency));
</script>

<section class="card chart">
	<div class="eyebrow-row">
		<Eyebrow emoji="📊" label="Every month on record" />
		<span class="eyebrow-caption">
			{#if months.length}
				{months[0].month} – {months[months.length - 1].month} · {savedRate}% saved on average
			{:else}
				appears once statements are imported
			{/if}
		</span>
	</div>

	{#if months.length > 0}
		<!-- Scrolls sideways rather than shrinking, as the Tax and Salary charts
		     do. The geometry is a fixed viewBox, so a narrower card is a shorter
		     chart too, and squeezed onto a phone the axis values print over one
		     another. -->
		<div class="plot-scroll">
			<div class="plot">
				<svg viewBox="0 0 {VIEW_W} {VIEW_H}" role="img" aria-label="Earned and spent by month">
					<defs>
						<linearGradient id="month-in" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0" style="stop-color: var(--green); stop-opacity: 0.9" />
							<stop offset="1" style="stop-color: var(--green); stop-opacity: 0.55" />
						</linearGradient>
						<linearGradient id="month-out" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0" style="stop-color: var(--red); stop-opacity: 0.85" />
							<stop offset="1" style="stop-color: var(--red); stop-opacity: 0.5" />
						</linearGradient>
					</defs>

					{#each grid as g (g.fraction)}
						<line x1={X_LEFT} y1={g.y} x2={X_RIGHT} y2={g.y} class="grid" />
						<line x1={X_LEFT - 5} y1={g.y} x2={X_LEFT} y2={g.y} class="tick" />
					{/each}
					<line x1={X_LEFT} y1={TOP} x2={X_LEFT} y2={BOTTOM} class="spine" />
					<line x1={X_LEFT} y1={BOTTOM} x2={X_RIGHT} y2={BOTTOM} class="spine" />

					{#if hover !== null}
						<!-- Under the bars, so the month being read is lit rather than
						     covered. -->
						<rect
							x={slotFor(hover, months.length) - (X_RIGHT - X_LEFT) / months.length / 2}
							y={TOP}
							width={(X_RIGHT - X_LEFT) / months.length}
							height={BOTTOM - TOP}
							class="lit"
						/>
					{/if}

					{#each months as m, i (m.month)}
						{#each barsFor(m, i, months.length, ceiling) as bar (bar.kind)}
							<rect
								x={bar.x}
								y={bar.y}
								width={bar.width}
								height={bar.height}
								rx="2"
								style="fill: url(#month-{bar.kind})"
							/>
						{/each}
					{/each}
				</svg>

				<span class="axis-title" style:top="{AXIS_TITLE_PCT}%">{axisUnit}</span>
				{#each grid as g (g.fraction)}
					<span class="axis-value" style:top="{(g.y / VIEW_H) * 100}%">{g.label}</span>
				{/each}
				{#each ticks as t (t.key)}
					<span
						class="axis-month mono"
						style:left="{(t.x / VIEW_W) * 100}%"
						style:top="{(AXIS_Y / VIEW_H) * 100}%">{t.label}</span
					>
				{/each}

				{#each months as m, i (m.month)}
					<button
						type="button"
						class="hit"
						style:left="{((slotFor(i, months.length) - (X_RIGHT - X_LEFT) / months.length / 2) /
							VIEW_W) *
							100}%"
						style:width="{((X_RIGHT - X_LEFT) / months.length / VIEW_W) * 100}%"
						onmouseenter={() => (hover = i)}
						onmouseleave={() => (hover = null)}
						onfocus={() => (hover = i)}
						onblur={() => (hover = null)}
						aria-label="{m.month} figures"
					></button>
				{/each}

				{#if hovered}
					{@const kept = keptPct(hovered)}
					<div
						class="readout"
						class:flip
						style:left="{(slotFor(hover!, months.length) / VIEW_W) * 100}%"
					>
						<span class="r-month mono">{hovered.month}</span>
						<div class="r-row">
							<span class="swatch in"></span>
							<span>earned</span>
							<strong class="mono">{money(hovered.earned)}</strong>
						</div>
						<div class="r-row">
							<span class="swatch out"></span>
							<span>spent</span>
							<strong class="mono">{money(hovered.spent)}</strong>
						</div>
						<div class="r-row total">
							<span class="swatch kept"></span>
							<span>kept</span>
							<strong class="mono" class:short={hovered.spent > hovered.earned}>
								{money(hovered.earned - hovered.spent)}
							</strong>
						</div>
						<div class="r-foot">
							<span>
								{#if kept === null}
									nothing came in this month
								{:else}
									{kept > 0 ? '+' : ''}{kept.toFixed(0)}% of what came in
								{/if}
							</span>
							<span class="r-unit">{unit}</span>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<span class="axis-caption">Month</span>
		<div class="legend">
			<span class="key"><span class="swatch in"></span> earned</span>
			<span class="key"><span class="swatch out"></span> spent</span>
			<span class="footnote">
				{negativeMonths === 0
					? 'no month spent more than it earned'
					: `${negativeMonths} months spent more than they earned`}
			</span>
		</div>
	{/if}
</section>

<style>
	.chart {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.plot-scroll {
		overflow-x: auto;
		/* The rotated axis title steps out into this padding when the gutter it
		   normally sits in is too narrow to hold it beside the value nearest it —
		   see the container query below. The negative margin gives the space back,
		   so on a wide card the plot occupies exactly the pixels it always did.

		   A container, so that decision is made from the width the PLOT actually
		   gets rather than the viewport's: the same viewport gives this card very
		   different widths with and without the sidebar. */
		container-type: inline-size;
		padding-left: 16px;
		margin-left: -16px;
	}
	.plot {
		position: relative;
		width: 100%;
		/* The width at which the axis values still have room apiece — roughly
		   what the chart already gets on a tablet. */
		min-width: 640px;
		aspect-ratio: 1000 / 260;
	}
	svg {
		width: 100%;
		height: 100%;
		display: block;
		overflow: visible;
	}
	.grid {
		stroke: var(--bd);
		stroke-width: 1;
	}
	.tick,
	.spine {
		stroke: var(--bd2);
		stroke-width: 1;
	}
	.lit {
		fill: var(--card2);
	}
	.axis-title {
		position: absolute;
		left: 0;
		font-size: var(--text-xs);
		color: var(--fg3);
		transform-origin: left top;
		/* Rotated about its top-left, so the text runs UP from the anchor; the
		   translate slides it back down by half its own length, centring it on
		   the band `top` names. */
		transform: rotate(-90deg) translateX(-50%);
		white-space: nowrap;
	}
	/* Snug against the plot's left edge, inside the gutter the axis values are
	   right-aligned in. That gutter is a PERCENTAGE of the plot's width while the
	   text in it is a fixed size, so below the width below it stops holding both
	   and the title lands on top of the value beside it — "Millions Kč" printed
	   through "2.6M". Only then does the title step out.

	   1024px is where a five-character value and the title's own band still
	   clear each other: the gutter is 5.2% of the plot, so about 53px, against
	   33px of value and 15px of rotated title. */
	@container (max-width: 1024px) {
		.axis-title {
			left: -16px;
		}
	}
	.axis-value {
		position: absolute;
		right: calc(100% - 5.2%);
		transform: translateY(-50%);
		font-size: var(--text-xs);
		color: var(--fg3);
		font-family: var(--font-mono);
		white-space: nowrap;
	}
	.axis-month {
		position: absolute;
		transform: translate(-50%, 4px);
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	/* Below the plot, in the flow, rather than hanging off its bottom edge.
	   Absolutely positioned at `bottom: -8%` it stuck out of the scroll
	   container, and a scroll container clips or scrolls what leaves it — so the
	   chart grew a vertical scrollbar of its own and could be dragged up and
	   down inside the card. */
	.axis-caption {
		display: block;
		margin-top: var(--space-3);
		text-align: center;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.hit {
		position: absolute;
		top: 0;
		height: 88%;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: default;
	}
	.readout {
		position: absolute;
		top: 4%;
		margin-left: 12px;
		min-width: 210px;
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-float);
		padding: var(--space-5) var(--space-6);
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		z-index: 2;
	}
	.readout.flip {
		margin-left: -12px;
		transform: translateX(-100%);
	}
	.r-month {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.r-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.r-row strong {
		margin-left: auto;
		color: var(--fg1);
	}
	/* Red only when the month ran short. A kept figure is the ordinary case and
	   colouring every one of them green would leave nothing for the exception. */
	.r-row strong.short {
		color: var(--red);
	}
	.r-row.total {
		border-top: 1px solid var(--bd2);
		padding-top: 4px;
		margin-top: 2px;
	}
	.r-foot {
		display: flex;
		gap: var(--space-3);
		border-top: 1px solid var(--bd);
		padding-top: 6px;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.r-unit {
		margin-left: auto;
	}
	.legend {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		flex-wrap: wrap;
		border-top: 1px solid var(--bd);
		padding-top: var(--space-6);
	}
	.key {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.swatch {
		width: 10px;
		height: 10px;
		border-radius: var(--radius-xs);
		flex: none;
	}
	.swatch.in {
		background: var(--green);
	}
	.swatch.out {
		background: var(--red);
	}
	.swatch.kept {
		background: linear-gradient(to bottom, var(--green) 0 50%, var(--red) 50% 100%);
	}
	.footnote {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
</style>
