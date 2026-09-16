<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Net worth as a line with a scale: three gridlines the loader labelled on
	// one shared step, and a year mark along the foot.
	let {
		data
	}: {
		data: {
			unit: string;
			caption: string;
			first?: number;
			last?: number;
			points: { x: number; y: number }[];
			yTicks: { y: number; label: string }[];
			xTicks: { x: number; label: string }[];
		};
	} = $props();

	// A filled area needs the line closed along the bottom edge.
	const area = $derived(
		data.points.length
			? `M0,100 L${data.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L')} L100,100 Z`
			: ''
	);
	const line = $derived(
		data.points.length
			? `M${data.points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' L')}`
			: ''
	);
	const rising = $derived((data.last ?? 0) >= (data.first ?? 0));
</script>

{#if data.points.length}
	<div class="wrap">
		<span class="caption">{data.caption} · {data.unit}</span>
		<div class="plot">
			<div class="y-axis mono" aria-hidden="true">
				{#each data.yTicks as t (t.label)}
					<span style:top="{t.y}%">{t.label}</span>
				{/each}
			</div>
			<div class="canvas">
				<svg
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					role="img"
					aria-label="Net worth over time"
				>
					{#each data.yTicks as t (t.label)}
						<line
							x1="0"
							x2="100"
							y1={t.y}
							y2={t.y}
							stroke="var(--bd)"
							stroke-width="1"
							vector-effect="non-scaling-stroke"
						/>
					{/each}
					<path d={area} fill={rising ? 'var(--green)' : 'var(--red)'} opacity="0.16" />
					<path
						d={line}
						fill="none"
						stroke={rising ? 'var(--green)' : 'var(--red)'}
						stroke-width="1.5"
						vector-effect="non-scaling-stroke"
					/>
				</svg>
				<div class="x-axis mono" aria-hidden="true">
					{#each data.xTicks as t (t.label)}
						<span style:left="{t.x}%">{t.label}</span>
					{/each}
				</div>
			</div>
		</div>
	</div>
{:else}
	<span class="quiet">{data.caption}</span>
{/if}

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		height: 100%;
	}
	.caption {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.plot {
		flex: 1;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-3);
		min-height: 0;
	}
	.y-axis {
		position: relative;
		margin-bottom: calc(var(--text-xs) * 1.6);
		width: 3.5em;
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.y-axis span {
		position: absolute;
		right: 0;
		transform: translateY(-50%);
		white-space: nowrap;
	}
	.canvas {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	svg {
		flex: 1;
		min-height: 60px;
		width: 100%;
	}
	.x-axis {
		position: relative;
		height: calc(var(--text-xs) * 1.6);
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.x-axis span {
		position: absolute;
		top: 2px;
		white-space: nowrap;
	}
</style>
