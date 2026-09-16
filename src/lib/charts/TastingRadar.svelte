<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The shape a bottle's tasting notes make. Markup only: every number comes
	 * from `tasting-radar.ts`. Axis labels are HTML pills over the SVG, not
	 * `<text>` inside it — a rounded fill behind SVG text never quite fits.
	 */
	import { LEAST_AXES, tastingRadar, type Mention } from '$lib/charts/tasting-radar';

	let { mentions, size = 240 }: { mentions: Mention[]; size?: number } = $props();

	const radar = $derived(tastingRadar(mentions, size));
</script>

{#if radar.axes.length >= LEAST_AXES}
	<div class="web" style:width="{size}px" style:height="{size}px">
		<svg viewBox="0 0 {size} {size}" width={size} height={size} aria-hidden="true">
			{#each radar.rings as ring (ring)}
				<circle cx={radar.centre} cy={radar.centre} r={ring} class="ring" />
			{/each}
			{#each radar.spokes as spoke, at (at)}
				<line x1={radar.centre} y1={radar.centre} x2={spoke.x} y2={spoke.y} class="spoke" />
			{/each}
			<polygon points={radar.points} class="shape" />
			{#each radar.axes as axis (axis.note)}
				<circle cx={axis.x} cy={axis.y} r="3" style:fill="var(--{axis.series})" />
			{/each}
		</svg>

		{#each radar.axes as axis (axis.note)}
			<span
				class="label"
				style:left="{(axis.labelX / size) * 100}%"
				style:top="{(axis.labelY / size) * 100}%"
				style:--ink="var(--{axis.series})"
			>
				<!-- "×2", not a bare 2, so it doesn't read as a rank. -->
				{axis.note} <span class="count mono">×{axis.count}</span>
			</span>
		{/each}
	</div>
{:else}
	<p class="not-yet">Three tastings with notes will draw a shape here.</p>
{/if}

<style>
	.web {
		position: relative;
		flex: none;
	}
	.ring {
		fill: none;
		stroke: var(--bd);
	}
	.spoke {
		stroke: var(--bd);
	}
	.shape {
		fill: color-mix(in srgb, var(--rose) 22%, transparent);
		stroke: var(--rose);
		stroke-width: 1.6;
		stroke-linejoin: round;
	}
	.label {
		position: absolute;
		transform: translate(-50%, -50%);
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
		padding: 2px var(--space-3);
		border-radius: var(--radius-pill);
		/* `--bg2`, not `--card`: `--card` is translucent in dark theme, so a spoke would show through. */
		background: color-mix(in srgb, var(--ink) 18%, var(--bg2));
		color: color-mix(in srgb, var(--ink) 70%, var(--fg1));
		font-size: var(--text-2xs);
		white-space: nowrap;
	}
	.count {
		opacity: 0.75;
	}
	.not-yet {
		margin: 0;
		max-width: 30ch;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
