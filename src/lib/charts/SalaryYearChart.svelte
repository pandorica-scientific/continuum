<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// Salary by year, in the Tax screen's visual language.
	//
	// The two tabs sit next to each other, so the panel geometry, the hatching,
	// the unified hover and the SVG constraints are shared rather than
	// reinvented — see tax-chart-geometry.ts and TaxYearChart.svelte for the
	// three SVG facts that govern both (var() in attributes, the letterboxed
	// viewBox, HTML axis labels).
	//
	// What differs is what a bar means. A tax bar splits what was kept from what
	// was taken; a salary bar splits the base from the bonus that was added to
	// it, with net marked as a tick across the whole.
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import { compactAxis, displayCurrency, formatMinor } from '$lib/money';
	import {
		MONEY_BOTTOM,
		MONEY_TITLE_PCT,
		MONEY_TOP,
		RATE_BOTTOM_Y,
		RATE_TITLE_PCT,
		TALL_TITLE_PCT,
		VIEW_H,
		VIEW_W,
		X_LEFT,
		X_RIGHT,
		barValues,
		barWidth,
		bars,
		ceilingFor,
		changeBand,
		changeRuns,
		changeSpan,
		changeY,
		netTickY,
		slotFor,
		type SalaryMode,
		type SerialisedSalaryYear
	} from '$lib/charts/salary-chart-geometry';

	let {
		years,
		currency,
		mode = $bindable(),
		onchange
	}: {
		years: SerialisedSalaryYear[];
		currency: string;
		mode: SalaryMode;
		onchange: (next: SalaryMode) => void;
	} = $props();

	let hover = $state<number | null>(null);

	const ceiling = $derived(ceilingFor(years, mode));
	const width = $derived(barWidth(Math.max(years.length, 1)));
	const band = $derived(changeBand(mode));
	const span = $derived(changeSpan(years));
	const anyBonus = $derived(years.some((y) => BigInt(y.bonusTotalMinor) > 0n));

	const totalRuns = $derived(changeRuns(years, (r) => r.deltaPct, span, band));
	const baseRuns = $derived(changeRuns(years, (r) => r.baseDeltaPct, span, band));

	const path = (points: { x: number; y: number }[]) =>
		points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');

	// Labels come from compactAxis rather than per-tick formatting: at some
	// magnitudes whole thousands collapse and two gridlines read the same.
	const moneyGrid = $derived.by(() => {
		const fractions = [0, 0.25, 0.5, 0.75, 1];
		const values = fractions.map((f) => BigInt(Math.round(Number(ceiling) * f)));
		const labels = compactAxis(values, currency);
		return fractions.map((f, i) => ({
			y: MONEY_BOTTOM - f * (MONEY_BOTTOM - MONEY_TOP),
			fraction: f,
			label: labels[i]
		}));
	});
	const changeGrid = $derived(
		(mode === 'change' ? [-1, -0.5, 0, 0.5, 1] : [-1, 0, 1]).map((f) => ({
			y: changeY(f * span, span, band),
			pct: Math.round(f * span)
		}))
	);

	const axisUnit = $derived.by(() => {
		const top = Number(ceiling) / 100;
		const symbol = displayCurrency(currency);
		if (top >= 1_000_000) return `Millions ${symbol}`;
		if (top >= 1_000) return `Thousands ${symbol}`;
		return symbol;
	});

	const hovered = $derived(hover === null ? null : (years[hover] ?? null));
	const flip = $derived(hover !== null && hover >= years.length / 2);

	const LABEL: Record<SalaryMode, string> = {
		avg: 'Average month',
		total: 'Yearly total',
		change: 'Year on year'
	};
</script>

<section class="card chart">
	<div class="head">
		<Eyebrow emoji="💼" label={LABEL[mode]} />
		<Segmented
			options={[
				{ value: 'avg', label: 'Average month' },
				{ value: 'total', label: 'Yearly total' },
				{ value: 'change', label: 'Change' }
			]}
			bind:value={mode}
			onchange={(next) => onchange(next as SalaryMode)}
		/>
	</div>

	{#if years.length === 0}
		<p class="empty">
			Nothing recorded yet — upload a payslip below, or categorise a salary credit on the
			Transactions screen, and the history draws itself.
		</p>
	{:else}
		<div class="plot">
			<svg viewBox="0 0 {VIEW_W} {VIEW_H}" role="img" aria-label="Salary by year">
				<defs>
					<filter id="salary-shadow" x="-50%" y="-50%" width="200%" height="200%">
						<feDropShadow dx="0" dy="1" stdDeviation="2" flood-opacity="0.3" />
					</filter>
					<linearGradient id="salary-base" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" style="stop-color: var(--series-health-soft); stop-opacity: 0.62" />
						<stop offset="1" style="stop-color: var(--series-health-soft); stop-opacity: 0.42" />
					</linearGradient>
					<pattern
						id="salary-bonus"
						width="7"
						height="7"
						patternUnits="userSpaceOnUse"
						patternTransform="rotate(45)"
					>
						<rect width="7" height="7" style="fill: var(--orange); fill-opacity: 0.12" />
						<line
							x1="0"
							y1="0"
							x2="0"
							y2="7"
							style="stroke: var(--orange); stroke-opacity: 0.5; stroke-width: 2.6"
						/>
					</pattern>
				</defs>

				{#if mode !== 'change'}
					{#each moneyGrid as g (g.fraction)}
						<line x1={X_LEFT} y1={g.y} x2={X_RIGHT} y2={g.y} class="grid" />
						<line x1={X_LEFT - 5} y1={g.y} x2={X_LEFT} y2={g.y} class="tick" />
					{/each}
					<line x1={X_LEFT} y1={MONEY_TOP} x2={X_LEFT} y2={MONEY_BOTTOM} class="spine" />
					<line x1={X_LEFT} y1={MONEY_BOTTOM} x2={X_RIGHT} y2={MONEY_BOTTOM} class="spine" />
				{/if}

				{#each changeGrid as g (g.pct)}
					<line x1={X_LEFT} y1={g.y} x2={X_RIGHT} y2={g.y} class="grid" class:zero={g.pct === 0} />
					<line x1={X_LEFT - 5} y1={g.y} x2={X_LEFT} y2={g.y} class="tick" />
				{/each}
				<line x1={X_LEFT} y1={band[0]} x2={X_LEFT} y2={band[1]} class="spine" />

				{#if mode !== 'change'}
					{#each years as row, i (row.year)}
						{#each bars(row, mode, ceiling) as seg, j (j)}
							<rect
								x={slotFor(i, years.length) - width / 2}
								y={seg.y}
								{width}
								height={seg.height}
								rx="2"
								filter="url(#salary-shadow)"
								style="fill: url(#salary-{seg.kind}); {seg.stroked
									? `stroke: var(${seg.kind === 'bonus' ? '--orange' : '--series-health-soft'}); stroke-width: 1`
									: 'stroke: none'}"
							/>
						{/each}
						{@const tick = netTickY(row, mode, ceiling)}
						{#if tick !== null}
							<line
								x1={slotFor(i, years.length) - width / 2}
								y1={tick}
								x2={slotFor(i, years.length) + width / 2}
								y2={tick}
								class="net-tick"
							/>
						{/if}
					{/each}
				{/if}

				<!-- The base line is the one that answers "did my salary go up".
				     The total moves with a one-off bonus and reads as a raise. -->
				{#each totalRuns as run, i (i)}
					{#if run.length > 1}<path d={path(run)} class="line total" />{/if}
					{#each run as p (p.year)}
						<circle cx={p.x} cy={p.y} r="3.5" class="dot total" />
					{/each}
				{/each}
				{#if anyBonus}
					{#each baseRuns as run, i (i)}
						{#if run.length > 1}<path d={path(run)} class="line base" />{/if}
						{#each run as p (p.year)}
							<circle cx={p.x} cy={p.y} r="3" class="dot base" />
						{/each}
					{/each}
				{/if}

				{#if hover !== null}
					<line
						x1={slotFor(hover, years.length)}
						y1={mode === 'change' ? band[0] : MONEY_TOP}
						x2={slotFor(hover, years.length)}
						y2={band[1]}
						class="guide"
					/>
				{/if}
			</svg>

			{#if mode !== 'change'}
				<span class="axis-title" style:top="{MONEY_TITLE_PCT}%">{axisUnit}</span>
				{#each moneyGrid as g (g.fraction)}
					<span class="axis-value" style:top="{(g.y / VIEW_H) * 100}%">{g.label}</span>
				{/each}
			{/if}
			<span class="axis-title" style:top="{mode === 'change' ? TALL_TITLE_PCT : RATE_TITLE_PCT}%"
				>Change</span
			>
			{#each changeGrid as g (g.pct)}
				<span class="axis-value" style:top="{(g.y / VIEW_H) * 100}%">{g.pct}%</span>
			{/each}
			{#each years as y, i (y.year)}
				<span
					class="axis-year mono"
					style:left="{(slotFor(i, years.length) / VIEW_W) * 100}%"
					style:top="{(RATE_BOTTOM_Y / VIEW_H) * 100}%">{y.year}</span
				>
			{/each}
			<span class="axis-caption">Year</span>

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
				{@const v = barValues(hovered, mode === 'change' ? 'total' : mode)}
				<div
					class="readout"
					class:flip
					style:left="{(slotFor(hover!, years.length) / VIEW_W) * 100}%"
				>
					<span class="r-year mono">{hovered.year}</span>
					<div class="r-row">
						<span class="swatch base"></span>
						<span>base</span>
						<strong class="mono">{formatMinor(v.base, currency)}</strong>
					</div>
					{#if v.bonus > 0n}
						<div class="r-row">
							<span class="swatch bonus"></span>
							<span>bonus</span>
							<strong class="mono">{formatMinor(v.bonus, currency)}</strong>
						</div>
					{/if}
					<!-- The sum the bar actually draws. base + bonus IS gross, and with
					     the two stacked it is worth stating rather than leaving to be
					     added up by eye — especially beside net, which is what was left
					     of this same figure rather than a further amount. -->
					<div class="r-row total">
						<span class="swatch gross"></span>
						<span>gross</span>
						<strong class="mono">{formatMinor(v.base + v.bonus, currency)}</strong>
					</div>
					{#if v.net !== null}
						<div class="r-row">
							<span class="swatch net"></span>
							<span>net</span>
							<strong class="mono">{formatMinor(v.net, currency)}</strong>
						</div>
					{/if}
					<div class="r-foot">
						{#if hovered.deltaPct !== null}
							<span>{hovered.deltaPct > 0 ? '+' : ''}{hovered.deltaPct}% total</span>
						{/if}
						{#if hovered.baseDeltaPct !== null && anyBonus}
							<span>{hovered.baseDeltaPct > 0 ? '+' : ''}{hovered.baseDeltaPct}% base</span>
						{/if}
						<span class="months">
							{hovered.grossMonths} gross · {hovered.netMonths} net
							{#if !hovered.netComplete && hovered.netMonths > 0}⚠{/if}
						</span>
					</div>
				</div>
			{/if}
		</div>

		<div class="legend">
			<span class="key"><span class="swatch base"></span> base salary</span>
			{#if anyBonus}
				<span class="key"><span class="swatch bonus"></span> bonus</span>
			{/if}
			<span class="key"><span class="swatch net"></span> net</span>
			<span class="key"><span class="swatch line-total"></span> change, total</span>
			{#if anyBonus}
				<span class="key"><span class="swatch line-base"></span> change, base only</span>
			{/if}
			<span class="footnote">
				{mode === 'total'
					? 'A year with fewer than twelve months is marked in its readout — a partial year is not a small one'
					: mode === 'avg'
						? 'Averaged over the months actually recorded, so a part year compares as a monthly rate'
						: 'Base excludes bonuses, so a one-off award does not read as a raise and then a cut'}
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
	.empty {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.plot {
		position: relative;
		width: 100%;
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
	.grid.zero {
		stroke: var(--bd2);
	}
	.tick,
	.spine {
		stroke: var(--bd2);
		stroke-width: 1;
	}
	.net-tick {
		stroke: var(--fg1);
		stroke-width: 1.6;
	}
	.line {
		fill: none;
		stroke-linejoin: round;
	}
	.line.total {
		stroke: var(--yellow);
		stroke-width: 2.5;
	}
	.line.base {
		stroke: var(--teal);
		stroke-width: 2;
		stroke-dasharray: 5 3;
	}
	.dot {
		stroke: var(--bg);
		stroke-width: 1.5;
	}
	.dot.total {
		fill: var(--yellow);
	}
	.dot.base {
		fill: var(--teal);
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
	.axis-caption {
		position: absolute;
		left: 50%;
		bottom: -8%;
		transform: translateX(-50%);
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
		margin-left: 12px;
		min-width: 210px;
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
		color: var(--fg2);
	}
	.r-row strong {
		margin-left: auto;
		color: var(--fg1);
	}
	.r-foot {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		border-top: 1px solid var(--bd);
		padding-top: 6px;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.months {
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
	.swatch.base {
		background: var(--series-health-soft);
	}
	.swatch.bonus {
		background: var(--orange);
	}
	.swatch.gross {
		background: linear-gradient(to bottom, var(--series-health-soft) 0 50%, var(--orange) 50% 100%);
	}
	.r-row.total {
		border-top: 1px solid var(--bd2);
		padding-top: 4px;
		margin-top: 2px;
	}
	.swatch.net {
		background: var(--fg1);
		height: 2px;
	}
	.swatch.line-total {
		background: var(--yellow);
		height: 2px;
	}
	.swatch.line-base {
		background: var(--teal);
		height: 2px;
	}
	.footnote {
		margin-left: auto;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
</style>
