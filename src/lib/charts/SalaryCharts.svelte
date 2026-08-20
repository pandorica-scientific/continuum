<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// The three salary plots: average monthly salary per year (bars), yearly
	// increase in % (lines), and change in % against age (lines) — people
	// overlaid in their own colours so trajectories compare directly.

	export interface SalaryPoint {
		year: number;
		age: number | null;
		avgMajor: number;
		deltaPct: number | null;
	}
	export interface SalaryPerson {
		name: string;
		colorVar: string;
		points: SalaryPoint[]; // ascending by year
	}
	let { people, unit }: { people: SalaryPerson[]; unit: string } = $props();

	const W = 460;
	const H = 190;
	const PAD = { top: 14, bottom: 24, left: 46, right: 10 };
	const innerW = W - PAD.left - PAD.right;
	const innerH = H - PAD.top - PAD.bottom;

	const withData = $derived(people.filter((p) => p.points.length > 0));

	// ---- chart 1: avg monthly salary per year (grouped bars) ----
	const years = $derived(
		[...new Set(withData.flatMap((p) => p.points.map((pt) => pt.year)))].sort()
	);
	const maxAvg = $derived(
		Math.max(1, ...withData.flatMap((p) => p.points.map((pt) => pt.avgMajor)))
	);
	const yearX = (year: number) => {
		const i = years.indexOf(year);
		return PAD.left + (innerW / Math.max(1, years.length)) * (i + 0.5);
	};
	const slotW = $derived(innerW / Math.max(1, years.length));
	const barW = $derived(Math.min(26, (slotW * 0.7) / Math.max(1, withData.length)));

	// ---- charts 2 & 3: % change vs year and vs age (lines) ----
	const deltas = $derived(withData.flatMap((p) => p.points.filter((pt) => pt.deltaPct !== null)));
	const deltaMax = $derived(Math.max(2, ...deltas.map((pt) => Math.abs(pt.deltaPct!))));
	const ages = $derived(
		[
			...new Set(
				withData.flatMap((p) =>
					p.points.filter((pt) => pt.age !== null && pt.deltaPct !== null).map((pt) => pt.age!)
				)
			)
		].sort((a, b) => a - b)
	);

	const deltaY = (pct: number) => PAD.top + innerH / 2 - (pct / deltaMax) * (innerH / 2);
	const lineOver = (
		points: { x: number; pct: number }[] // x already in svg units
	) => points.map((pt) => `${pt.x},${deltaY(pt.pct)}`).join(' ');

	const ageX = (age: number) => {
		if (ages.length <= 1) return PAD.left + innerW / 2;
		const lo = ages[0];
		const hi = ages[ages.length - 1];
		return PAD.left + ((age - lo) / (hi - lo)) * innerW;
	};

	const kfmt = (v: number) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
</script>

{#if withData.length}
	<div class="charts">
		<figure>
			<figcaption>Avg monthly salary per year · {unit}</figcaption>
			<svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet">
				{#each [0.5, 1] as f (f)}
					<line
						x1={PAD.left}
						y1={PAD.top + innerH - innerH * f}
						x2={W - PAD.right}
						y2={PAD.top + innerH - innerH * f}
						class="grid"
					/>
					<text x={PAD.left - 6} y={PAD.top + innerH - innerH * f + 3} class="mono axis">
						{kfmt(maxAvg * f)}
					</text>
				{/each}
				<line
					x1={PAD.left}
					y1={PAD.top + innerH}
					x2={W - PAD.right}
					y2={PAD.top + innerH}
					class="base"
				/>
				{#each withData as p, pi (pi)}
					{#each p.points as pt (pt.year)}
						{@const h = (pt.avgMajor / maxAvg) * innerH}
						<rect
							x={yearX(pt.year) - (barW * withData.length) / 2 + pi * barW}
							y={PAD.top + innerH - h}
							width={barW - 2}
							height={h}
							style:fill="var({p.colorVar})"
							rx="2"
						>
							<title>{p.name} · {pt.year} · {Math.round(pt.avgMajor).toLocaleString('en')}</title>
						</rect>
					{/each}
				{/each}
				{#each years as y (y)}
					<text x={yearX(y)} y={H - 8} class="mono axis mid">{y}</text>
				{/each}
			</svg>
		</figure>

		<figure>
			<figcaption>Yearly salary increase · %</figcaption>
			<svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet">
				<line x1={PAD.left} y1={deltaY(0)} x2={W - PAD.right} y2={deltaY(0)} class="base" />
				{#each [deltaMax, -deltaMax] as v (v)}
					<text x={PAD.left - 6} y={deltaY(v) + 3} class="mono axis"
						>{v > 0 ? '+' : ''}{Math.round(v)}%</text
					>
				{/each}
				<text x={PAD.left - 6} y={deltaY(0) + 3} class="mono axis">0</text>
				{#each withData as p, pi (pi)}
					{@const pts = p.points.filter((pt) => pt.deltaPct !== null)}
					{#if pts.length >= 2}
						<polyline
							points={lineOver(pts.map((pt) => ({ x: yearX(pt.year), pct: pt.deltaPct! })))}
							style:stroke="var({p.colorVar})"
							class="line"
						/>
					{/if}
					{#each pts as pt (pt.year)}
						<circle
							cx={yearX(pt.year)}
							cy={deltaY(pt.deltaPct!)}
							r="3.5"
							style:fill="var({p.colorVar})"
						>
							<title
								>{p.name} · {pt.year} · {pt.deltaPct! > 0 ? '+' : ''}{pt.deltaPct!.toFixed(
									1
								)}%</title
							>
						</circle>
					{/each}
				{/each}
				{#each years as y (y)}
					<text x={yearX(y)} y={H - 8} class="mono axis mid">{y}</text>
				{/each}
			</svg>
		</figure>

		{#if ages.length}
			<figure>
				<figcaption>Salary change vs age · %</figcaption>
				<svg viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet">
					<line x1={PAD.left} y1={deltaY(0)} x2={W - PAD.right} y2={deltaY(0)} class="base" />
					{#each [deltaMax, -deltaMax] as v (v)}
						<text x={PAD.left - 6} y={deltaY(v) + 3} class="mono axis"
							>{v > 0 ? '+' : ''}{Math.round(v)}%</text
						>
					{/each}
					<text x={PAD.left - 6} y={deltaY(0) + 3} class="mono axis">0</text>
					{#each withData as p, pi (pi)}
						{@const pts = p.points.filter((pt) => pt.age !== null && pt.deltaPct !== null)}
						{#if pts.length >= 2}
							<polyline
								points={lineOver(pts.map((pt) => ({ x: ageX(pt.age!), pct: pt.deltaPct! })))}
								style:stroke="var({p.colorVar})"
								class="line"
							/>
						{/if}
						{#each pts as pt (pt.year)}
							<circle
								cx={ageX(pt.age!)}
								cy={deltaY(pt.deltaPct!)}
								r="3.5"
								style:fill="var({p.colorVar})"
							>
								<title
									>{p.name} · age {pt.age} · {pt.deltaPct! > 0 ? '+' : ''}{pt.deltaPct!.toFixed(
										1
									)}%</title
								>
							</circle>
						{/each}
					{/each}
					{#each ages as a (a)}
						<text x={ageX(a)} y={H - 8} class="mono axis mid">{a}</text>
					{/each}
				</svg>
			</figure>
		{/if}
	</div>
	<div class="legend">
		{#each withData as p, pi (pi)}
			<span class="key"><span class="dot" style:background="var({p.colorVar})"></span>{p.name}</span
			>
		{/each}
	</div>
{/if}

<style>
	.charts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 18px;
	}
	figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	figcaption {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	svg {
		width: 100%;
		display: block;
		background: var(--card2);
		border: 1px solid var(--bd);
		border-radius: 10px;
	}
	.grid {
		stroke: var(--bd);
		stroke-width: 1;
	}
	.base {
		stroke: var(--bd2);
		stroke-width: 1;
	}
	.line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
	}
	.axis {
		font-size: var(--text-2xs);
		fill: var(--fg3);
		text-anchor: end;
	}
	.axis.mid {
		text-anchor: middle;
	}
	.legend {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}
	.key {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 9px;
	}
</style>
