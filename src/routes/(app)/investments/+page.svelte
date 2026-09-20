<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
	import { submitAction } from '$lib/actions/result';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import SummaryBand from '$lib/components/SummaryBand.svelte';
	import DocumentsCard from '$lib/components/DocumentsCard.svelte';
	import EquityCard from '$lib/components/EquityCard.svelte';
	import DataTable from '$lib/components/DataTable.svelte';
	import type { Column } from '$lib/components/data-table';

	let { data, form } = $props();

	// Keyed on the message, not a bare boolean: a new failure must reappear
	// even when the previous one was dismissed.
	let dismissed = $state<string | null>(null);
	const errorMessage = $derived(form?.message && form.message !== dismissed ? form.message : null);

	const HOLDING_COLUMNS = $derived<Column[]>([
		{ key: 'holding', label: 'Holding', width: 'minmax(0, 1.4fr)' },
		{ key: 'units', label: 'Units', align: 'end', width: 'minmax(84px, auto)', hideBelow: 760 },
		{ key: 'value', label: 'Value', align: 'end', width: 'minmax(110px, auto)' },
		{
			key: 'base',
			label: `In ${data.unit}`,
			align: 'end',
			width: 'minmax(110px, auto)',
			hideBelow: 900
		},
		{ key: 'gain', label: 'Gain', align: 'end', width: 'minmax(72px, auto)' }
	]);

	// FileList from a browse or drop; File[] from the scan engine.
	async function upload(files: FileList | File[]) {
		const file = files[0];
		if (!file) return { type: 'error' as const, message: 'Choose a report first.' };
		const body = new FormData();
		body.set('report', file);
		return submitAction('?/upload', body);
	}

	// Chart geometry: 800×200 viewBox, HTML axis labels outside the SVG.
	const CW = 800;
	const CH = 200;
	const chart = $derived.by(() => {
		if (data.series.length < 2) return null;
		const max = Math.max(
			...data.series.map((p) => Math.max(p.moneyIn, p.bench10, p.actual ?? 0)),
			1
		);
		const x = (i: number) => (i / (data.series.length - 1)) * CW;
		const y = (v: number) => CH - (v / max) * CH;
		const line = (pick: (p: (typeof data.series)[number]) => number | null) =>
			data.series
				.map((p, i) => {
					const v = pick(p);
					return v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`;
				})
				.filter(Boolean)
				.join(' ');
		// Which points are hard market values from a report rather than reconstruction.
		const actualPoints = data.series
			.map((p, i) => (p.isSnapshot && p.actual !== null ? { x: x(i), y: y(p.actual) } : null))
			.filter((p): p is { x: number; y: number } => p !== null);
		// Where the actual line starts and stops, so its fill closes at its own
		// ends rather than the plot's.
		const actualIndexes = data.series.map((p, i) => (p.actual === null || p.isMarked ? null : i));
		const firstActual = actualIndexes.find((i) => i !== null) ?? 0;
		const lastActual = [...actualIndexes].reverse().find((i) => i !== null) ?? 0;
		const actualSpan = { x0: x(firstActual).toFixed(1), x1: x(lastActual).toFixed(1) };
		// After the last report, the line continues dashed off the last reported
		// point, so it reads as one line changing character, not two lines.
		const lastSnapshotFromEnd = [...data.series].reverse().findIndex((p) => p.isSnapshot);
		const anchor = lastSnapshotFromEnd === -1 ? -1 : data.series.length - 1 - lastSnapshotFromEnd;
		const marked =
			anchor === -1
				? ''
				: data.series
						.map((p, i) =>
							(i === anchor || (i > anchor && p.isMarked)) && p.actual !== null
								? `${x(i).toFixed(1)},${y(p.actual).toFixed(1)}`
								: null
						)
						.filter((s): s is string => s !== null)
						.join(' ');
		// Drawn at the FIRST month of each year rather than spaced evenly: the series
		// can start mid-year, and an evenly spaced rule would mislead. Labels are
		// positioned from this same index so they line up with their rule.
		const years = [...new Set(data.series.map((p) => p.month.slice(0, 4)))].map((year) => {
			const index = data.series.findIndex((p) => p.month.slice(0, 4) === year);
			const left = (x(index) / CW) * 100;
			return { year, left, end: left > 90 };
		});
		const yearLines = years.filter((y) => y.left > 0).map((y) => (y.left / 100) * CW);
		// One unit for the whole axis: millions when the top gridline reaches
		// them, thousands otherwise.
		const inMillions = max >= 1e6;
		const axis = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
			top: `${f * 100}%`,
			label: inMillions
				? (((1 - f) * max) / 1e6).toFixed(1)
				: `${Math.round(((1 - f) * max) / 1000)}k`
		}));
		return {
			moneyIn: line((p) => p.moneyIn),
			bench5: line((p) => p.bench5),
			bench10: line((p) => p.bench10),
			actual: line((p) => (p.isMarked ? null : p.actual)),
			marked,
			actualPoints,
			actualSpan,
			years,
			yearLines,
			axis
		};
	});

	/**
	 * Which point the pointer is nearest, or null when it is not over the plot.
	 *
	 * Index rather than a pixel: the series is what gets read out, and snapping
	 * to a real point is the only honest thing a line between monthly readings
	 * can say. The plot is drawn with `preserveAspectRatio="none"`, so the x
	 * mapping is a straight proportion of the element's own width.
	 */
	let hover = $state<number | null>(null);
	let plot = $state<HTMLElement | null>(null);

	function track(event: PointerEvent) {
		if (!plot || !chart) return;
		const box = plot.getBoundingClientRect();
		if (box.width === 0) return;
		const fraction = (event.clientX - box.left) / box.width;
		const last = data.series.length - 1;
		hover = Math.max(0, Math.min(last, Math.round(fraction * last)));
	}

	const reading = $derived(hover === null ? null : (data.series[hover] ?? null));
	/** Percent across the plot, for the guide line and the readout box. */
	const hoverLeft = $derived(
		hover === null || data.series.length < 2 ? 0 : (hover / (data.series.length - 1)) * 100
	);
	const money = (value: number) =>
		value.toLocaleString('en-GB', { maximumFractionDigits: 0 }).replace(/,/g, "'");
</script>

<ScreenHeader
	title="Investments"
	caption="Updated by uploading the XTB account statement. Duplicates are dropped by operation id."
/>

{#if errorMessage}
	<div class="error" role="alert">
		<span>{errorMessage}</span>
		<button
			type="button"
			class="dismiss"
			aria-label="Dismiss"
			onclick={() => (dismissed = errorMessage)}
		>
			✕
		</button>
	</div>
{/if}

<section class="section">
	<div class="eyebrow-row">
		<Eyebrow hue="--purple" icon="wallet" label="Portfolio" />
		<span class="eyebrow-caption">
			{data.asOf ? `from the report of ${data.asOf}` : 'upload the first report below'}
		</span>
	</div>
	<!-- The tax figure is an estimate, and it says so. It knows nothing about
	     losses carried forward from earlier years, other income, allowances, or
	     anything held outside this instance. The rate is configured below rather
	     than assumed: it differs by country. -->
	<SummaryBand
		tiles={[
			{
				label: 'Portfolio',
				value: data.metrics.portfolio,
				unit: data.accountUnit,
				note: data.metrics.portfolioBase
					? `≈ ${data.metrics.portfolioBase} ${data.unit}`
					: undefined,
				wash: 'purple'
			},
			...(data.metrics.withEquity || data.metrics.equityAbsence
				? [
						{
							label: 'With equity',
							value: data.metrics.withEquity?.value ?? '—',
							unit: data.metrics.withEquity ? data.accountUnit : undefined,
							// Says which of the reasons it is. "No price" sent somebody
							// looking for a broken feed when the grant simply had not
							// vested yet.
							note: data.metrics.withEquity
								? `portfolio + ${data.metrics.withEquity.equity} in grants · ${data.metrics.withEquity.units} units, vested and not`
								: data.metrics.equityAbsence === 'unpriced'
									? 'no price for the grant yet'
									: data.metrics.equityAbsence === 'unconverted'
										? 'no rate to convert the grant yet'
										: 'nothing left in the grant',
							wash: 'purple'
						}
					]
				: []),
			{
				label: 'Money in',
				value: data.metrics.moneyIn,
				unit: data.accountUnit,
				note: data.metrics.since ? `since ${data.metrics.since}` : undefined,
				wash: 'teal'
			},
			{
				label: 'Gain',
				value: data.metrics.gain,
				unit: data.accountUnit,
				color: data.metrics.gainPositive ? 'var(--green)' : 'var(--red)',
				note: data.metrics.gainPct ?? undefined,
				wash: data.metrics.gainPositive ? 'green' : 'red'
			},
			{
				label: 'Annualised',
				value: data.metrics.annualised ?? '—',
				note: 'nominal, on money in',
				wash: 'teal'
			},
			{
				label: `Tax on ${data.tax.year} gains`,
				value: data.tax.configured ? data.tax.estimated : '—',
				unit: data.tax.configured ? data.accountUnit : undefined,
				note: data.tax.configured
					? `estimate · ${data.tax.ratePct}% of ${data.tax.taxable}`
					: 'set a rate in Settings › Money'
			}
		]}
	/>
</section>

{#if chart}
	<section class="card chart-card">
		<div class="eyebrow-row">
			<Eyebrow hue="--purple" icon="trend" label="Value against money in" />
			<span class="eyebrow-caption">
				{data.accountUnit} · benchmarks use the same contribution dates
			</span>
		</div>
		<div class="chart">
			{#each chart.axis as a (a.top)}
				<span class="axis mono" style:top={a.top}>{a.label}</span>
			{/each}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="plot"
				bind:this={plot}
				onpointermove={track}
				onpointerleave={() => (hover = null)}
			>
				<svg viewBox="0 0 800 200" preserveAspectRatio="none">
					{#each [0, 50, 100, 150] as gy (gy)}
						<line
							x1="0"
							y1={gy}
							x2="800"
							y2={gy}
							stroke="var(--bd)"
							stroke-width="1"
							vector-effect="non-scaling-stroke"
						/>
					{/each}
					<!-- Where each year begins. Structure rather than data, so it is drawn
				     at the weight the horizontal gridlines already use. -->
					{#each chart.yearLines as gx (gx)}
						<line
							x1={gx}
							y1="0"
							x2={gx}
							y2="200"
							stroke="var(--bd)"
							stroke-width="1"
							vector-effect="non-scaling-stroke"
						/>
					{/each}
					<line
						x1="0"
						y1="200"
						x2="800"
						y2="200"
						stroke="var(--bd2)"
						stroke-width="1"
						vector-effect="non-scaling-stroke"
					/>
					<polyline
						points={chart.bench5}
						fill="none"
						stroke="var(--orange)"
						stroke-width="2"
						stroke-dasharray="3 4"
						vector-effect="non-scaling-stroke"
					/>
					<polyline
						points={chart.bench10}
						fill="none"
						stroke="var(--purple)"
						stroke-width="2"
						stroke-dasharray="3 4"
						vector-effect="non-scaling-stroke"
					/>
					<polyline
						points={chart.moneyIn}
						fill="none"
						stroke="var(--fg3)"
						stroke-width="2"
						stroke-dasharray="6 4"
						vector-effect="non-scaling-stroke"
					/>
					{#if chart.actualPoints.length > 0}
						<!-- The area under the actual line, teal fading to nothing. The
					     benchmarks stay bare strokes: a fill says "this is what you
					     have", and only one of these four lines is that. -->
						<defs>
							<linearGradient id="inv-actual" x1="0" y1="0" x2="0" y2="1">
								<stop offset="0" style="stop-color: var(--teal); stop-opacity: 0.35" />
								<stop offset="1" style="stop-color: var(--teal); stop-opacity: 0" />
							</linearGradient>
						</defs>
						<polygon
							points="{chart.actual} {chart.actualSpan.x1},200 {chart.actualSpan.x0},200"
							fill="url(#inv-actual)"
							stroke="none"
						/>
						<polyline
							points={chart.actual}
							fill="none"
							stroke="var(--teal)"
							stroke-width="2.5"
							stroke-linejoin="round"
							vector-effect="non-scaling-stroke"
						/>
					{/if}
					{#if chart.marked}
						<polyline
							points={chart.marked}
							fill="none"
							stroke="var(--teal)"
							stroke-width="2.5"
							stroke-dasharray="6 4"
							stroke-linejoin="round"
							vector-effect="non-scaling-stroke"
						>
							<title>marked to market</title>
						</polyline>
					{/if}
					{#if hover !== null}
						<line
							x1={(hoverLeft / 100) * 800}
							y1="0"
							x2={(hoverLeft / 100) * 800}
							y2="200"
							stroke="var(--fg3)"
							stroke-width="1"
							vector-effect="non-scaling-stroke"
						/>
					{/if}
				</svg>
				{#if reading}
					<!-- Positioned in percent so it follows the same proportion the
				     stretched viewBox uses; flipped to the left near the right edge
				     so it never runs off the card. -->
					<div
						class="readout"
						class:flip={hoverLeft > 60}
						style:left="{hoverLeft}%"
						role="status"
						aria-live="polite"
					>
						<span class="r-month mono">{reading.month}</span>
						{#if reading.actual !== null}
							<span class="r-line">
								<span class="r-dot" style="background: var(--teal)"></span>
								<span class="r-name">{reading.isMarked ? 'marked to market' : 'value'}</span>
								<span class="mono r-value">{money(reading.actual)}</span>
							</span>
						{/if}
						<span class="r-line">
							<span class="r-dot" style="background: var(--fg3)"></span>
							<span class="r-name">money in</span>
							<span class="mono r-value">{money(reading.moneyIn)}</span>
						</span>
						{#if reading.actual !== null}
							<span class="r-gain" class:down={reading.actual < reading.moneyIn}>
								{reading.actual >= reading.moneyIn ? '+' : '−'}{money(
									Math.abs(reading.actual - reading.moneyIn)
								)}
							</span>
						{/if}
					</div>
				{/if}
			</div>
		</div>
		<div class="years mono">
			{#each chart.years as y (y.year)}<span style:left="{y.left}%" class:end={y.end}>{y.year}</span
				>{/each}
		</div>
		<div class="legend">
			<span class="l"
				><span class="swatch" style="border-top: 2.5px solid var(--teal);"></span>actual</span
			>
			{#if data.markedAsOf}
				<span class="l"
					><span class="swatch" style="border-top: 2.5px dashed var(--teal);"></span>marked to
					market · to {data.markedAsOf}</span
				>
			{/if}
			<span class="l"
				><span class="swatch" style="border-top: 2px dashed var(--fg3);"></span>money in</span
			>
			<span class="l"
				><span class="swatch" style="border-top: 2px dashed var(--orange);"></span>at 5% a year</span
			>
			<span class="l"
				><span class="swatch" style="border-top: 2px dashed var(--purple);"></span>at 10% a year</span
			>
			<span class="l-note">market value at report dates · at cost + realised between</span>
		</div>
		{#if data.unpricedTickers.length > 0}
			<!-- No feed has ever priced this one — often because the broker's own
			     ticker for it isn't what a feed calls the same security (Tesla on
			     Xetra trades as "TL0", not "TSLA"). The dashed tail above stays
			     undrawn until every holding has at least one close on file. -->
			<div class="unpriced">
				{#each data.unpricedTickers as u (u.ticker)}
					<form method="POST" action="?/setPrice" use:enhance class="price-prompt">
						<input type="hidden" name="ticker" value={u.ticker} />
						<input type="hidden" name="currency" value={u.currency} />
						<span class="quiet"
							>No feed prices {u.ticker} · type today's close to start the tail</span
						>
						<input
							name="close"
							inputmode="decimal"
							placeholder="close in {u.currency}"
							aria-label="Close price for {u.ticker} in {u.currency}"
							required
						/>
						<button type="submit" class="btn small">Save</button>
					</form>
					<!-- The one-time fix, beside the every-time one: a feed usually
					     just calls the same security something else, not nothing —
					     Tesla on Xetra is "TL0", not "TSLA". Saved once, tried right
					     away, and the prompts above stop as soon as it works. -->
					<form method="POST" action="?/setPriceAlias" use:enhance class="price-prompt">
						<input type="hidden" name="ticker" value={u.ticker} />
						<span class="quiet">or if a feed calls it something else</span>
						<input
							name="overrideBase"
							placeholder="e.g. TL0"
							aria-label="What a feed calls {u.ticker}"
							required
						/>
						<button type="submit" class="btn small">Fetch automatically</button>
					</form>
				{/each}
			</div>
		{/if}
	</section>
{/if}

<div class="own-row">
	{#if data.donut.length}
		<section class="card own">
			<Eyebrow hue="--purple" icon="chart" label="What you own">
				{#snippet right()}
					<span class="quiet"
						>{data.donut.length}
						{data.donut.length === 1 ? 'holding' : 'holdings'}</span
					>
				{/snippet}
			</Eyebrow>
			<div class="donut-wrap">
				<div
					class="donut"
					style:background={`conic-gradient(${data.donut.map((s) => `${s.color} ${s.from}% ${s.to}%`).join(', ')})`}
				></div>
				<div class="legend-col">
					{#each data.donut as s, i (i)}
						<div class="legend-row">
							<span class="dot" style:background={s.color}></span>
							<span class="mono l-ticker">{s.label}</span>
							<span class="l-name">{s.name}</span>
							<span class="mono l-pct">{s.pct.toFixed(1)}%</span>
						</div>
					{/each}
				</div>
			</div>
		</section>
	{/if}

	<section class="card holdings">
		<div class="eyebrow-row" style="padding-bottom: 8px;">
			<Eyebrow hue="--purple" icon="ledger" label="Holdings" />
			<span class="eyebrow-caption">duplicates dropped by operation id</span>
		</div>
		{#if data.holdings.length}
			<DataTable
				columns={HOLDING_COLUMNS}
				groups={[{ key: 'all', open: true, rows: data.holdings }]}
				flat
				hue="--purple"
				label="Holdings"
				rowKey={(h) => h.id}
			>
				{#snippet row(h, visible)}
					<div class="h-name">
						<span class="swatch" style:background="var({h.colorVar})" aria-hidden="true"></span>
						<span class="h-names">
							<span class="mono ticker">{h.ticker}</span>
							<span class="name">{h.name}</span>
						</span>
					</div>
					{#if visible.has('units')}<span class="mono r muted">{h.units}</span>{/if}
					<span class="mono r">{h.value}</span>
					{#if visible.has('base')}<span class="mono r muted">{h.base}</span>{/if}
					<span class="mono r" style:color={h.gainColor}>{h.gain}</span>
				{/snippet}
			</DataTable>
		{:else}
			<p class="quiet">No holdings yet — upload a report below.</p>
		{/if}

		<UploadDropzone
			accept=".xlsx"
			idleText="📥 Drop the XTB account statement here, or click to browse"
			busyText="Reading the report…"
			reportErrors={false}
			onfiles={upload}
		/>
		{#if form?.result}
			<span class="quiet">
				{form.result.operationsAdded} operations added, {form.result.operationsKnown} already known ·
				{form.result.holdings} holdings as of {form.result.snapshotDay}
			</span>
			<!-- The ledger landed either way; this is about where the PAPER went.
			     Silence here is what let a report sit unattached and unnoticed. -->
			{#if form.result.unattached === 'no-brokerage-account'}
				<span class="quiet warn">
					Filed, but not attached to an account. Add a brokerage account and upload again to see it
					on the Statements shelf.
				</span>
			{:else if form.result.unattached === 'several-brokerage-accounts'}
				<span class="quiet warn">
					Filed. You have more than one brokerage account, so attach it to the right one from the
					Accounts screen.
				</span>
			{/if}
		{/if}
	</section>
</div>

<EquityCard rows={data.equity} unit={data.unit} />

<!-- Read-only: no attach, no addHref. The Accounts screen already carries the
     full attach/detach card for the brokerage account these reports are filed
     against; this is a second, convenient place to see the same paper without
     duplicating that management surface here. -->
<DocumentsCard
	heading="Reports"
	documents={data.reports}
	target={data.reportsTarget}
	emptyText="No broker reports filed yet — upload one above and it appears here."
/>

<style>
	/* The ledger landed; the paper may not have. Orange rather than red: nothing
	   failed, but something needs doing before the report can be found again. */
	.quiet.warn {
		color: var(--orange);
	}

	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-6);
	}
	.dismiss {
		background: none;
		border: 0;
		color: inherit;
		cursor: pointer;
		font-size: var(--text-lg);
		line-height: 1;
		padding: var(--space-1) var(--space-2);
	}
	.chart-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.chart {
		position: relative;
		padding-left: 46px;
	}
	/* Holds the svg and the hover readout in one coordinate space, so a percent
	   position means the same thing to both. */
	.plot {
		position: relative;
		touch-action: pan-y;
	}
	.readout {
		position: absolute;
		top: 6px;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		/* Clear of the guide line rather than under the pointer. */
		margin-left: 10px;
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--bg2);
		box-shadow: var(--shadow-float);
		font-size: var(--text-sm);
		white-space: nowrap;
		/* The pointer is tracked on the plot beneath; the box must never eat the
		   move events or it would flicker as it follows. */
		pointer-events: none;
	}
	.readout.flip {
		margin-left: 0;
		transform: translateX(-100%) translateX(-10px);
	}
	.r-month {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.r-line {
		display: grid;
		grid-template-columns: 8px auto 1fr;
		align-items: center;
		gap: var(--space-3);
	}
	.r-dot {
		width: 8px;
		height: 2px;
		border-radius: 1px;
	}
	.r-name {
		color: var(--fg3);
	}
	.r-value {
		text-align: right;
	}
	.r-gain {
		margin-top: 2px;
		padding-top: 3px;
		border-top: 1px solid var(--bd);
		text-align: right;
		color: var(--green);
	}
	.r-gain.down {
		color: var(--red);
	}
	.axis {
		position: absolute;
		left: 0;
		width: 36px;
		text-align: right;
		transform: translateY(-50%);
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	/* Each label sits at its own year rule rather than being spread evenly. The
	   last one is pulled back inside the plot so it cannot run off the edge. */
	.years {
		position: relative;
		height: 1.2em;
		margin-left: 46px;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.years span {
		position: absolute;
		top: 0;
		padding-left: 4px;
		white-space: nowrap;
	}
	.years span.end {
		transform: translateX(-100%);
		padding-left: 0;
		padding-right: 4px;
	}
	.legend {
		display: flex;
		gap: 14px 18px;
		flex-wrap: wrap;
		font-size: var(--text-sm);
		color: var(--fg2);
		border-top: 1px solid var(--bd);
		padding-top: 12px;
	}
	.l {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.unpriced {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: 12px;
	}
	.price-prompt {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
	}
	.price-prompt input {
		height: 36px;
		max-width: 180px;
	}
	/* A line sample, not the holdings' colour bar below — must not share that class name. */
	.legend .swatch {
		width: 16px;
		height: 0;
		display: inline-block;
		border-radius: 0;
	}
	.l-note {
		margin-left: auto;
		color: var(--fg3);
		font-size: var(--text-xs);
	}
	.own-row {
		display: grid;
		grid-template-columns: minmax(260px, 1fr) minmax(0, 1.4fr);
		gap: var(--space-8);
		align-items: start;
	}
	@media (max-width: 1100px) {
		.own-row {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.own {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}
	/* Chart on the left, legend on the right, so the donut doesn't sit fixed-size
	   in a much wider card with the legend stacked underneath it. */
	.donut-wrap {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 22px;
		flex-wrap: wrap;
	}
	.donut {
		/* Sized from the box rather than pinned: it grows with the card and stops
		   at a size beyond which a pie says nothing more. */
		width: clamp(148px, 34%, 240px);
		aspect-ratio: 1;
		border-radius: 50%;
		flex: 0 1 auto;
		display: grid;
		place-items: center;
	}
	/* A pie, not a donut: the hole's count now lives in the panel header. */
	.legend-col {
		flex: 1 1 240px;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.legend-row {
		display: grid;
		grid-template-columns: 11px 90px minmax(0, 1fr) auto;
		gap: 9px;
		align-items: center;
		font-size: var(--text-sm);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 3px;
	}
	.l-ticker {
		color: var(--fg1);
	}
	.l-name {
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.l-pct {
		color: var(--fg3);
	}
	.holdings {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.h-name {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
	}
	.h-names {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	/* The same colour as the wedge in the pie beside it. A bar and not a dot:
	   8×22 reads down the list as a stripe of colour. */
	.h-name .swatch {
		width: 8px;
		height: 22px;
		border-radius: var(--radius-xs);
		flex: none;
	}
	.ticker {
		font-size: var(--text-md);
	}
	.name {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.r {
		text-align: right;
		font-size: var(--text-md);
	}
	.muted {
		color: var(--fg3);
	}
	:global(.dropzone) {
		margin-top: 12px;
		border: 1.5px dashed var(--bd2);
		background: transparent;
		border-radius: var(--radius-lg);
		padding: 14px;
		color: var(--fg2);
		font-size: var(--text-md);
		cursor: pointer;
		text-align: center;
	}
	:global(.dropzone:hover),
	:global(.dropzone.dragging) {
		border-color: var(--blue);
	}
	:global(.dropzone.dragging) {
		background: var(--blue-tint);
	}
</style>
