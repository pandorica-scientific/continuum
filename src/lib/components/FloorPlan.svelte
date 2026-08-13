<script lang="ts">
	import {
		outlinePath,
		PLAN_COLS,
		PLAN_ROWS,
		roomAreaM2,
		roomBounds,
		totalAreaM2,
		type PlanDrawing
	} from '$lib/plan';

	let {
		drawing,
		cell = 10,
		showTotal = true
	}: { drawing: PlanDrawing; cell?: number; showTotal?: boolean } = $props();
</script>

<div class="wrap">
	<svg
		viewBox="0 0 {PLAN_COLS * cell} {PLAN_ROWS * cell}"
		preserveAspectRatio="xMidYMid meet"
		class="plan"
	>
		{#each drawing.rooms as room, i (i)}
			{@const bounds = roomBounds(room)}
			<path d={outlinePath(room.cells, cell)} class="room" fill-rule="evenodd" />
			{#if room.name}
				<text
					x={(bounds.x + bounds.w / 2) * cell}
					y={(bounds.y + bounds.h / 2) * cell - 14}
					class="room-name"
				>
					{room.name}
				</text>
				<text
					x={(bounds.x + bounds.w / 2) * cell}
					y={(bounds.y + bounds.h / 2) * cell + 20}
					class="room-area mono"
				>
					{roomAreaM2(room, drawing.cellCm).toFixed(1)} m²
				</text>
			{/if}
		{/each}
	</svg>
	{#if showTotal}
		<span class="total mono">{totalAreaM2(drawing).toFixed(1)} m² total</span>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		height: 100%;
	}
	.plan {
		width: 100%;
		height: 100%;
		display: block;
	}
	.room {
		fill: var(--card2);
		stroke: var(--fg2);
		stroke-width: 2.5;
		stroke-linejoin: miter;
	}
	.room-name {
		fill: var(--fg1);
		font-size: 26px;
		font-family: var(--font-sans);
		text-anchor: middle;
		dominant-baseline: middle;
	}
	.room-area {
		fill: var(--fg3);
		font-size: 20px;
		text-anchor: middle;
		dominant-baseline: middle;
	}
	.total {
		position: absolute;
		right: 8px;
		bottom: 6px;
		font-size: 11px;
		color: var(--fg3);
		text-shadow:
			0 0 8px var(--bg),
			0 0 4px var(--bg);
	}
</style>
