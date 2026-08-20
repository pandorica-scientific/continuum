<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import Eyebrow from '$lib/components/Eyebrow.svelte';

	interface Point {
		year: number;
		gross: number;
		tax: number;
		ratePct: number | null;
	}
	interface Series {
		key: string;
		label: string;
		currency: string;
		points: Point[];
	}

	let { series }: { series: Series[] } = $props();

	const COLORS = ['var(--blue)', 'var(--green)', 'var(--yellow)', 'var(--red)'];
	const W = 560;
	const H = 180;
	const PAD = { left: 46, right: 12, top: 12, bottom: 24 };

	const colorOf = (key: string) => COLORS[series.findIndex((s) => s.key === key) % COLORS.length];

	/**
	 * Money charts get one panel per currency: nothing is converted, so PLN and
	 * CZK must never share an axis. The rate chart is a percentage and is one
	 * shared panel — the comparable figure across countries.
	 */
	const currencies = $derived([...new Set(series.map((s) => s.currency))]);

	function panel(list: Series[], pick: (p: Point) => number | null) {
		const years = [...new Set(list.flatMap((s) => s.points.map((p) => p.year)))].sort();
		const values = list.flatMap((s) => s.points.map(pick)).filter((v): v is number => v !== null);
		if (years.length === 0 || values.length === 0) return null;
		const maxV = Math.max(...values) * 1.08 || 1;
		const x = (year: number) =>
			years.length === 1
				? (W + PAD.left - PAD.right) / 2
				: PAD.left +
					((year - years[0]) / (years[years.length - 1] - years[0])) * (W - PAD.left - PAD.right);
		const y = (v: number) => H - PAD.bottom - (v / maxV) * (H - PAD.top - PAD.bottom);
		return {
			years,
			maxV,
			lines: list.map((s) => ({
				key: s.key,
				label: s.label,
				dots: s.points
					.filter((p) => pick(p) !== null)
					.map((p) => ({ cx: x(p.year), cy: y(pick(p)!), year: p.year, value: pick(p)! }))
			}))
		};
	}

	const short = (v: number) =>
		v >= 1000000
			? `${(v / 1000000).toFixed(1)}M`
			: v >= 1000
				? `${Math.round(v / 1000)}k`
				: String(Math.round(v));
</script>

{#snippet chart(title: string, list: Series[], pick: (p: Point) => number | null, unit: string)}
	{@const p = panel(list, pick)}
	{#if p}
		<div class="card chart">
			<span class="c-title">{title}</span>
			<svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet">
				<line
					x1={PAD.left}
					y1={H - PAD.bottom}
					x2={W - PAD.right}
					y2={H - PAD.bottom}
					stroke="var(--bd2)"
				/>
				<text x={PAD.left - 6} y={PAD.top + 8} text-anchor="end" class="axis">
					{short(p.maxV)}{unit}
				</text>
				{#each p.years as year (year)}
					{@const first = p.lines.flatMap((l) => l.dots).find((d) => d.year === year)}
					{#if first}
						<text x={first.cx} y={H - 8} text-anchor="middle" class="axis">{year}</text>
					{/if}
				{/each}
				{#each p.lines as line (line.key)}
					{#if line.dots.length > 1}
						<polyline
							points={line.dots.map((d) => `${d.cx},${d.cy}`).join(' ')}
							fill="none"
							stroke={colorOf(line.key)}
							stroke-width="2"
						/>
					{/if}
					{#each line.dots as d (d.year)}
						<circle cx={d.cx} cy={d.cy} r="3.5" fill={colorOf(line.key)}>
							<title>{line.label} · {d.year}: {d.value.toLocaleString('en')}{unit}</title>
						</circle>
					{/each}
				{/each}
			</svg>
			<div class="legend">
				{#each list as s (s.key)}
					<span class="l-item"
						><span class="dot" style:background={colorOf(s.key)}></span>{s.label}</span
					>
				{/each}
			</div>
		</div>
	{/if}
{/snippet}

<section class="section">
	<div class="eyebrow-row">
		<Eyebrow emoji="📈" label="History" />
		<span class="eyebrow-caption"
			>one line per person and country · rates are comparable, money is per currency</span
		>
	</div>
	<div class="charts">
		{#each currencies as currency (currency)}
			{@const inCurrency = series.filter((s) => s.currency === currency)}
			{@render chart(`Gross income by year (${currency})`, inCurrency, (p) => p.gross, '')}
			{@render chart(`Tax paid by year (${currency})`, inCurrency, (p) => p.tax, '')}
		{/each}
		{@render chart('Effective rate by year', series, (p) => p.ratePct, '%')}
	</div>
</section>

<style>
	.charts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(330px, 1fr));
		gap: 14px;
	}
	.chart {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.c-title {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	svg {
		width: 100%;
		height: auto;
	}
	.axis {
		font-size: var(--text-2xs);
		fill: var(--fg3);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.l-item {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
	}
</style>
