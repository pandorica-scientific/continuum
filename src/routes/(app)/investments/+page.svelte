<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { submitAction } from '$lib/actions/result';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import MetricTile from '$lib/components/MetricTile.svelte';

	let { data, form } = $props();

	// Dismissal is keyed on the message itself rather than being a bare boolean:
	// a new failure must reappear even when the previous one was dismissed, and
	// a flag somebody has to remember to reset is how that stops happening.
	let dismissed = $state<string | null>(null);
	const errorMessage = $derived(form?.message && form.message !== dismissed ? form.message : null);

	async function upload(files: FileList) {
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
		// Which points are hard market values from a report rather than
		// reconstruction. This decides whether the actual line is drawn at all;
		// it no longer draws a marker per point — a single snapshot rendered as
		// one dot at the right-hand end, which read as a defect rather than data.
		const actualPoints = data.series
			.map((p, i) => (p.isSnapshot && p.actual !== null ? { x: x(i), y: y(p.actual) } : null))
			.filter((p): p is { x: number; y: number } => p !== null);
		const years = [...new Set(data.series.map((p) => p.month.slice(0, 4)))];
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
			actual: line((p) => p.actual),
			actualPoints,
			years,
			axis
		};
	});
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
		<Eyebrow emoji="💼" label="Portfolio" />
		<span class="eyebrow-caption">
			{data.asOf ? `from the report of ${data.asOf}` : 'upload the first report below'}
		</span>
	</div>
	<div class="tiles">
		<MetricTile
			label="Portfolio"
			value={data.metrics.portfolio}
			unit={data.accountUnit}
			note={data.metrics.portfolioBase ? `≈ ${data.metrics.portfolioBase} ${data.unit}` : undefined}
		/>
		<MetricTile
			label="Money in"
			value={data.metrics.moneyIn}
			unit={data.accountUnit}
			note={data.metrics.since ? `since ${data.metrics.since}` : undefined}
		/>
		<MetricTile
			label="Gain"
			value={data.metrics.gain}
			unit={data.accountUnit}
			color={data.metrics.gainPositive ? 'var(--green)' : 'var(--red)'}
			note={data.metrics.gainPct ?? undefined}
		/>
		<MetricTile
			label="Annualised"
			value={data.metrics.annualised ?? '—'}
			note="nominal, on money in"
		/>
	</div>
</section>

{#if chart}
	<section class="card chart-card">
		<div class="eyebrow-row">
			<Eyebrow emoji="📈" label="Value against money in" />
			<span class="eyebrow-caption">
				{data.accountUnit} · benchmarks use the same contribution dates
			</span>
		</div>
		<div class="chart">
			{#each chart.axis as a (a.top)}
				<span class="axis mono" style:top={a.top}>{a.label}</span>
			{/each}
			<svg viewBox="0 0 800 200" preserveAspectRatio="none">
				{#each [0, 50, 100, 150] as gy (gy)}
					<line x1="0" y1={gy} x2="800" y2={gy} stroke="var(--bd)" stroke-width="1" />
				{/each}
				<line x1="0" y1="200" x2="800" y2="200" stroke="var(--bd2)" stroke-width="1" />
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
					<polyline
						points={chart.actual}
						fill="none"
						stroke="var(--teal)"
						stroke-width="2.5"
						stroke-linejoin="round"
						vector-effect="non-scaling-stroke"
					/>
				{/if}
			</svg>
		</div>
		<div class="years mono">
			{#each chart.years as y (y)}<span>{y}</span>{/each}
		</div>
		<div class="legend">
			<span class="l"
				><span class="swatch" style="border-top: 2.5px solid var(--teal);"></span>actual</span
			>
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
	</section>
{/if}

<div class="own-row">
	{#if data.donut.length}
		<section class="card own">
			<Eyebrow emoji="🥧" label="What you own" />
			<div class="donut-wrap">
				<div
					class="donut"
					style:background={`conic-gradient(${data.donut.map((s) => `${s.color} ${s.from}% ${s.to}%`).join(', ')})`}
				>
					<div class="hole"><span class="mono">{data.donut.length}</span></div>
				</div>
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
			<Eyebrow emoji="📋" label="Holdings" />
			<span class="eyebrow-caption">duplicates dropped by operation id</span>
		</div>
		{#if data.holdings.length}
			<div class="h-head">
				<span>Holding</span><span class="r">Units</span><span class="r">Value</span><span class="r"
					>In {data.unit}</span
				><span class="r">Gain</span>
			</div>
			{#each data.holdings as h (h.id)}
				<div class="h-row">
					<div class="h-name">
						<span class="mono ticker">{h.ticker}</span>
						<span class="name">{h.name}</span>
					</div>
					<span class="mono r muted">{h.units}</span>
					<span class="mono r">{h.value}</span>
					<span class="mono r muted">{h.base}</span>
					<span class="mono r" style:color={h.gainColor}>{h.gain}</span>
				</div>
			{/each}
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
		{/if}
	</section>
</div>

<style>
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
		padding: 2px 4px;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: var(--space-6);
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
	.years {
		display: flex;
		justify-content: space-between;
		margin-left: 46px;
		font-size: var(--text-xs);
		color: var(--fg3);
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
	.swatch {
		width: 16px;
		display: inline-block;
	}
	.l-note {
		margin-left: auto;
		color: var(--fg3);
		font-size: var(--text-xs);
	}
	.own-row {
		display: grid;
		grid-template-columns: minmax(280px, 2fr) minmax(0, 3fr);
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
	.donut-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
	}
	.donut {
		width: 148px;
		height: 148px;
		border-radius: 148px;
		flex: 0 0 148px;
		display: grid;
		place-items: center;
	}
	.hole {
		width: 88px;
		height: 88px;
		border-radius: 88px;
		background: var(--bg2);
		display: grid;
		place-items: center;
		font-size: var(--text-md);
	}
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
	.h-head,
	.h-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) repeat(4, minmax(84px, auto));
		gap: 10px 14px;
		align-items: baseline;
	}
	.h-head {
		padding: 0 0 8px;
		font-size: var(--text-xs);
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--fg3);
		border-bottom: 1px solid var(--bd);
	}
	.h-row {
		padding: 11px 0;
		border-bottom: 1px solid var(--bd);
	}
	.h-name {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
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
	.quiet {
		font-size: var(--text-sm);
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
	@media (max-width: 720px) {
		.h-head,
		.h-row {
			grid-template-columns: minmax(0, 1fr) repeat(2, minmax(70px, auto));
		}
		.h-head span:nth-child(2),
		.h-row .muted:first-of-type {
			display: none;
		}
	}
</style>
