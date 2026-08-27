<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// One chart for the whole record, replacing six per-currency panels.
	//
	// Two modes over one x axis. In `stack`, each bar's full height IS that
	// year's gross: its foot is the tax, hatched, and what stands above is what
	// was kept. In `rate`, the bars give way to one line per jurisdiction.
	//
	// Three constraints here are SVG facts, not preferences:
	//
	//  1. An SVG attribute does not resolve var(). fill="var(--x)" paints
	//     nothing, so every fill, stroke and stop-color goes through `style`.
	//     A url(#id) reference is fine as an attribute.
	//  2. A fixed pixel height letterboxes the viewBox — it scales to fit and
	//     centres, so anything positioned in percentages drifts. The wrapper is
	//     pinned to the viewBox's aspect ratio and the SVG fills it.
	//  3. Axis labels are HTML, absolutely positioned. They are selectable,
	//     inherit the page's font stack, and need no fill of their own.
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import { compactAxis, displayCurrency, formatMinor } from '$lib/money';
	import {
		MONEY_BOTTOM,
		MONEY_TITLE_PCT,
		MONEY_TOP,
		RATE_BOTTOM_Y,
		RATE_TITLE_PCT,
		RATE_TOP_PCT,
		TALL_TITLE_PCT,
		VIEW_H,
		VIEW_W,
		X_LEFT,
		X_RIGHT,
		barWidth,
		maxGross,
		rateBand,
		rateRuns,
		rateY,
		segments,
		slotFor,
		type SerialisedYear
	} from '$lib/charts/tax-chart-geometry';

	let {
		years,
		countries,
		currency,
		currencies,
		mode = $bindable(),
		onchange
	}: {
		years: SerialisedYear[];
		countries: { code: string; name: string; token: string }[];
		currency: string;
		currencies: string[];
		mode: 'stack' | 'rate';
		onchange: (next: { mode?: 'stack' | 'rate'; currency?: string }) => void;
	} = $props();

	let hover = $state<number | null>(null);
	// Writable derived: the segmented control binds to it, and a new currency
	// arriving from the server after a save overwrites what was bound.
	let displayCurrencyCode = $derived(currency);

	const hues = $derived(new Map(countries.map((c) => [c.code, c.token])));
	const nameOf = $derived(new Map(countries.map((c) => [c.code, c.name])));
	const ceiling = $derived(maxGross(years));
	const width = $derived(barWidth(Math.max(years.length, 1)));

	/** Only the jurisdictions that actually appear, so the legend has no ghosts. */
	const present = $derived(
		countries.filter((c) => years.some((y) => y.byCountry.some((b) => b.country === c.code)))
	);

	const bars = $derived(
		years.map((row, i) => ({
			row,
			x: slotFor(i, years.length),
			segments: segments(row, ceiling, hues)
		}))
	);

	// In rate mode the line owns the whole plot; in stack mode it shares the
	// strip beneath the bars.
	const band = $derived(rateBand(mode));
	const blendedRun = $derived(
		years
			.map((row, i) => ({ row, i }))
			.filter(({ row }) => row.ratePct !== null)
			.map(({ row, i }) => ({ x: slotFor(i, years.length), y: rateY(row.ratePct!, band) }))
	);

	const path = (points: { x: number; y: number }[]) =>
		points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');

	// Gridlines at quarters of the money panel, and at 5% steps of the rate
	// strip. Both derived from the panel, so a changed viewBox moves them too.
	// Labels come from compactAxis rather than per-tick formatting: at some
	// magnitudes whole thousands collapse and two gridlines read the same.
	const moneyGrid = $derived.by(() => {
		const fractions = [0, 0.25, 0.5, 0.75, 1];
		const values = fractions.map((f) => BigInt(Math.round(Number(ceiling) * f)));
		const labels = compactAxis(values, currency);
		return fractions.map((f, i) => ({
			y: MONEY_BOTTOM - f * (MONEY_BOTTOM - MONEY_TOP),
			label: f,
			text: labels[i]
		}));
	});
	const rateGrid = $derived(
		(mode === 'rate' ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1]).map((f) => ({
			y: band[1] - f * (band[1] - band[0]),
			pct: Math.round(f * RATE_TOP_PCT)
		}))
	);

	/** The y-axis unit follows the display currency's own magnitude. */
	const axisUnit = $derived.by(() => {
		const top = Number(ceiling) / 100;
		const symbol = displayCurrency(currency);
		if (top >= 1_000_000) return `Millions ${symbol}`;
		if (top >= 1_000) return `Thousands ${symbol}`;
		return symbol;
	});

	const hovered = $derived(hover === null ? null : (years[hover] ?? null));
	/** Past the midpoint the readout flips, so it never runs off the right edge. */
	const flip = $derived(hover !== null && hover >= years.length / 2);
</script>

<section class="card chart">
	<div class="head">
		<Eyebrow emoji="📈" label={mode === 'stack' ? 'Earned & paid' : 'Effective rate'} />
		<div class="controls">
			<Segmented
				options={[
					{ value: 'stack', label: 'Earned & paid' },
					{ value: 'rate', label: 'Effective rate' }
				]}
				bind:value={mode}
				onchange={(next) => onchange({ mode: next as 'stack' | 'rate' })}
			/>
			{#if currencies.length > 1}
				<Segmented
					options={currencies.map((c) => ({ value: c, label: displayCurrency(c) }))}
					bind:value={displayCurrencyCode}
					onchange={(next) => onchange({ currency: next })}
				/>
			{/if}
		</div>
	</div>

	{#if years.length === 0}
		<p class="empty">Nothing filed yet — the chart draws itself once a statement is recorded.</p>
	{:else}
		<!-- Scrolls sideways rather than shrinking. The geometry is a fixed
		     viewBox, so a narrower card is a shorter chart too, and on a phone the
		     panel collapsed to about a hundred pixels — with eight axis values
		     printed over one another inside it. The matrices answer "this does not
		     fit a phone" the same way. -->
		<div class="plot-scroll">
			<div class="plot">
				<svg viewBox="0 0 {VIEW_W} {VIEW_H}" role="img" aria-label="Tax by year">
					<defs>
						<filter id="tax-bar-shadow" x="-50%" y="-50%" width="200%" height="200%">
							<feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.3" />
						</filter>
						{#each present as c (c.code)}
							<linearGradient id="tax-fill-{c.code}" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0" style="stop-color: var({c.token}); stop-opacity: 0.62" />
								<stop offset="1" style="stop-color: var({c.token}); stop-opacity: 0.42" />
							</linearGradient>
							<pattern
								id="tax-hatch-{c.code}"
								width="7"
								height="7"
								patternUnits="userSpaceOnUse"
								patternTransform="rotate(45)"
							>
								<rect width="7" height="7" style="fill: var({c.token}); fill-opacity: 0.12" />
								<line
									x1="0"
									y1="0"
									x2="0"
									y2="7"
									style="stroke: var({c.token}); stroke-opacity: 0.5; stroke-width: 2.6"
								/>
							</pattern>
						{/each}
					</defs>

					<!-- gridlines -->
					{#if mode === 'stack'}
						{#each moneyGrid as g (g.label)}
							<line x1={X_LEFT} y1={g.y} x2={X_RIGHT} y2={g.y} class="grid" />
							<line x1={X_LEFT - 5} y1={g.y} x2={X_LEFT} y2={g.y} class="tick" />
						{/each}
					{/if}
					{#each rateGrid as g (g.pct)}
						<line x1={X_LEFT} y1={g.y} x2={X_RIGHT} y2={g.y} class="grid" />
						<line x1={X_LEFT - 5} y1={g.y} x2={X_LEFT} y2={g.y} class="tick" />
					{/each}

					<!-- spines -->
					{#if mode === 'stack'}
						<line x1={X_LEFT} y1={MONEY_TOP} x2={X_LEFT} y2={MONEY_BOTTOM} class="spine" />
						<line x1={X_LEFT} y1={MONEY_BOTTOM} x2={X_RIGHT} y2={MONEY_BOTTOM} class="spine" />
					{/if}
					<line x1={X_LEFT} y1={band[0]} x2={X_LEFT} y2={band[1]} class="spine" />
					<line x1={X_LEFT} y1={band[1]} x2={X_RIGHT} y2={band[1]} class="spine" />

					{#if mode === 'stack'}
						{#each bars as bar (bar.row.year)}
							{#each bar.segments as seg, i (i)}
								<rect
									x={bar.x - width / 2}
									y={seg.y}
									{width}
									height={seg.height}
									rx="2"
									filter="url(#tax-bar-shadow)"
									style="fill: url(#tax-{seg.hatched
										? 'hatch'
										: 'fill'}-{seg.country}); {seg.stroked
										? `stroke: var(${seg.token}); stroke-width: 1`
										: 'stroke: none'}"
								/>
							{/each}
						{/each}
					{:else}
						{#each present as c (c.code)}
							{#each rateRuns(years, c.code, band) as run, i (i)}
								{#if run.length > 1}
									<path d={path(run)} class="rate-line" style="stroke: var({c.token})" />
								{/if}
								{#each run as p (p.year)}
									<circle cx={p.x} cy={p.y} r="3.5" style="fill: var({c.token})" class="dot" />
								{/each}
							{/each}
						{/each}
					{/if}

					<!-- the household's blended rate, always -->
					{#if blendedRun.length > 1}
						<path
							d={path(blendedRun)}
							class="blended"
							style="stroke-width: {mode === 'rate' ? 3 : 2}"
						/>
					{/if}
					{#each blendedRun as p, i (i)}
						<circle cx={p.x} cy={p.y} r="3.5" class="blended-dot" />
					{/each}

					<!-- the hovered year's guide -->
					{#if hover !== null}
						<line
							x1={slotFor(hover, years.length)}
							y1={mode === 'stack' ? MONEY_TOP : band[0]}
							x2={slotFor(hover, years.length)}
							y2={band[1]}
							class="guide"
						/>
					{/if}
				</svg>

				<!-- Axis labels as HTML. See the header comment. -->
				{#if mode === 'stack'}
					<span class="axis-title" style:top="{MONEY_TITLE_PCT}%">{axisUnit}</span>
					{#each moneyGrid as g (g.label)}
						<span class="axis-value" style:top="{(g.y / VIEW_H) * 100}%">{g.text}</span>
					{/each}
				{/if}
				<span class="axis-title" style:top="{mode === 'rate' ? TALL_TITLE_PCT : RATE_TITLE_PCT}%"
					>Rate</span
				>
				{#each rateGrid as g (g.pct)}
					<span class="axis-value" style:top="{(g.y / VIEW_H) * 100}%">{g.pct}%</span>
				{/each}
				{#each years as y, i (y.year)}
					<span
						class="axis-year mono"
						style:left="{(slotFor(i, years.length) / VIEW_W) * 100}%"
						style:top="{(RATE_BOTTOM_Y / VIEW_H) * 100}%">{y.year}</span
					>
				{/each}

				<!--
				One hit area per year, not per mark: a per-mark tooltip cannot answer
				"which country is this AND what were the others that year". The spans
				sit above the SVG and cover it, which is also why no mark carries an
				SVG <title> — it would be an unreachable second tooltip.
			-->
				{#each years as y, i (y.year)}
					<button
						type="button"
						class="hit"
						style:left="{((slotFor(i, years.length) - (X_RIGHT - X_LEFT) / years.length / 2) /
							VIEW_W) *
							100}%"
						style:width="{((X_RIGHT - X_LEFT) / years.length / VIEW_W) * 100}%"
						onmouseenter={() => (hover = i)}
						onmouseleave={() => (hover = null)}
						onfocus={() => (hover = i)}
						onblur={() => (hover = null)}
						aria-label="{y.year} figures"
					></button>
				{/each}

				{#if hovered}
					<!--
					The offset is folded into the positioning value rather than written
					as translateX(calc(-100% - 12px)) — a calc() inside an interpolated
					style value may not survive the parser, and the flip silently stops.
				-->
					<div
						class="readout"
						class:flip
						style:left="{(slotFor(hover!, years.length) / VIEW_W) * 100}%"
					>
						<span class="r-year mono">{hovered.year}</span>
						{#each hovered.byCountry as c (c.country)}
							<div class="r-row">
								<span class="swatch" style="background: var({hues.get(c.country)})"></span>
								<span class="r-name">{nameOf.get(c.country) ?? c.country}</span>
								<span class="mono r-rate"
									>{c.ratePct === null ? '—' : `${c.ratePct.toFixed(2)}%`}</span
								>
							</div>
							<div class="r-figures">
								earned <strong class="mono">{formatMinor(BigInt(c.grossMinor), currency)}</strong>
								· tax <strong class="mono">{formatMinor(BigInt(c.taxMinor), currency)}</strong>
								{#each c.native ?? [] as n, i (i)}
									<span class="r-filed"
										>filed {formatMinor(BigInt(n.grossMinor), n.currency)}
										{displayCurrency(n.currency)}</span
									>
								{/each}
							</div>
						{/each}
						{#if hovered.byCountry.length > 1}
							<div class="r-total">
								<span>all</span>
								<strong class="mono">{formatMinor(BigInt(hovered.grossMinor), currency)}</strong>
								<span class="mono"
									>{hovered.ratePct === null ? '—' : `${hovered.ratePct.toFixed(2)}%`}</span
								>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<span class="axis-caption">Tax year</span>
		<div class="legend">
			{#each present as c (c.code)}
				<span class="key">
					<span class="swatch" style="background: var({c.token})"></span>
					{c.name}
				</span>
			{/each}
			<span class="key">
				<span class="swatch dashed"></span>
				bar = earned · hatched foot = tax paid
			</span>
			<span class="key">
				<span class="swatch rate-key"></span>
				effective rate
			</span>
			<span class="footnote">
				{mode === 'stack'
					? "Converted at each year's closing rate — comparison, not a filed figure"
					: 'Rates need no conversion, which is why this line was always the honest one'}
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
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.controls {
		display: flex;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.empty {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* Pinned to the viewBox. A fixed pixel height would letterbox it and every
	   percentage-positioned label would drift. */
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
		/* The width at which the two stacked bands still have room for their axis
		   values — roughly what the chart already gets on a tablet. */
		min-width: 640px;
		aspect-ratio: 1000 / 322;
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
	.tick {
		stroke: var(--bd2);
		stroke-width: 1;
	}
	.spine {
		stroke: var(--bd2);
		stroke-width: 1;
	}
	.rate-line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
	}
	.dot {
		stroke: var(--bg);
		stroke-width: 1.5;
	}
	.blended {
		fill: none;
		stroke: var(--yellow);
		stroke-linejoin: round;
	}
	.blended-dot {
		fill: var(--yellow);
		stroke: var(--bg);
		stroke-width: 1.5;
	}
	.guide {
		stroke: var(--bd2);
		stroke-width: 1;
	}
	.axis-title {
		position: absolute;
		left: 0;
		font-size: var(--text-xs);
		color: var(--fg3);
		transform-origin: left top;
		/* Rotated about its top-left, so the text runs UP from the anchor; the
		   translate slides it back down by half its own length, centring it on
		   the band `top` names. The anchors are derived in the geometry module —
		   they used to be eyeballed percentages that missed both band centres. */
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
	.axis-year {
		position: absolute;
		transform: translate(-50%, 6px);
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
		height: 91%;
		border: 0;
		padding: 0;
		background: transparent;
		cursor: default;
	}
	.readout {
		position: absolute;
		top: 4%;
		/* The flip's offset lives in these two rules, not in a calc() inside an
		   interpolated style value — that silently fails to parse. */
		margin-left: 12px;
		transform: none;
		min-width: 250px;
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
		padding: 10px 12px;
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
	.r-year {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.r-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.r-rate {
		margin-left: auto;
		color: var(--yellow);
	}
	.r-figures {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		font-size: var(--text-xs);
		color: var(--fg3);
		padding-left: 17px;
	}
	.r-filed {
		width: 100%;
	}
	.r-total {
		display: flex;
		gap: var(--space-4);
		border-top: 1px solid var(--bd);
		padding-top: 6px;
		font-size: var(--text-sm);
		color: var(--fg2);
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
	.swatch.dashed {
		border: 1px dashed var(--fg3);
		background: transparent;
	}
	.swatch.rate-key {
		background: var(--yellow);
	}
	.footnote {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
</style>
