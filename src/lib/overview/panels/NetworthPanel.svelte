<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	let {
		data
	}: {
		data: {
			unit: string;
			caption: string;
			first?: number;
			last?: number;
			points: { x: number; y: number }[];
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
		<span class="caption">{data.caption}</span>
		<svg
			viewBox="0 0 100 100"
			preserveAspectRatio="none"
			role="img"
			aria-label="Net worth over time"
		>
			<path d={area} fill={rising ? 'var(--green)' : 'var(--red)'} opacity="0.16" />
			<path
				d={line}
				fill="none"
				stroke={rising ? 'var(--green)' : 'var(--red)'}
				stroke-width="1.5"
				vector-effect="non-scaling-stroke"
			/>
		</svg>
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
	svg {
		flex: 1;
		min-height: 60px;
		width: 100%;
	}
	.quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
