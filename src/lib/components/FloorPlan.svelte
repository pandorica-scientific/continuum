<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
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
		showTotal = true,
		counts = [],
		onroom
	}: {
		drawing: PlanDrawing;
		cell?: number;
		showTotal?: boolean;
		/** Photos per room, in drawing order; drawn under the area. */
		counts?: number[];
		/** Pressing a room opens its gallery. Without it, rooms are not pressable. */
		onroom?: (index: number) => void;
	} = $props();

	const countLine = (i: number) => {
		const n = counts[i] ?? 0;
		return n === 0 ? 'no images' : `${n} ${n === 1 ? 'image' : 'images'}`;
	};
</script>

<div class="wrap">
	<svg
		viewBox="0 0 {PLAN_COLS * cell} {PLAN_ROWS * cell}"
		preserveAspectRatio="xMidYMid meet"
		class="plan"
	>
		{#each drawing.rooms as room, i (i)}
			{@const bounds = roomBounds(room)}
			{@const cx = (bounds.x + bounds.w / 2) * cell}
			{@const cy = (bounds.y + bounds.h / 2) * cell}
			<!-- A room is the gallery's index: press it and its photos open. The
			     group is the target, so the name and the count are part of it. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<g
				class="room-group"
				class:pressable={!!onroom}
				role={onroom ? 'button' : undefined}
				tabindex={onroom ? 0 : undefined}
				aria-label={onroom ? `${room.name || 'Room'} · ${countLine(i)}` : undefined}
				onclick={() => onroom?.(i)}
				onkeydown={(e) => {
					if (!onroom) return;
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onroom(i);
					}
				}}
			>
				<path d={outlinePath(room.cells, cell)} class="room" fill-rule="evenodd" />
				{#if room.name}
					<text x={cx} y={cy - (onroom ? 22 : 14)} class="room-name">{room.name}</text>
					<text x={cx} y={cy + (onroom ? 10 : 20)} class="room-area mono">
						{roomAreaM2(room, drawing.cellCm).toFixed(1)} m²
					</text>
					{#if onroom}
						<text x={cx} y={cy + 36} class="room-count" class:none={(counts[i] ?? 0) === 0}>
							{countLine(i)}
						</text>
					{/if}
				{/if}
			</g>
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
	/* A room is a tile in the area's hue, as the handoff draws it, not an
	   outline on paper: the plan is read as rooms, and a filled shape reads
	   as a room where a stroked one reads as a diagram. */
	.room {
		fill: color-mix(in srgb, var(--purple) 10%, var(--surface));
		stroke: color-mix(in srgb, var(--purple) 40%, transparent);
		stroke-width: 2;
		stroke-linejoin: round;
	}
	.room-name {
		fill: var(--fg1);
		font-size: var(--text-4xl);
		font-family: var(--font-sans);
		text-anchor: middle;
		dominant-baseline: middle;
	}
	.room-area {
		fill: var(--fg3);
		font-size: var(--text-2xl);
		text-anchor: middle;
		dominant-baseline: middle;
	}
	.room-count {
		fill: var(--purple);
		font-size: var(--text-xl);
		font-family: var(--font-sans);
		text-anchor: middle;
		dominant-baseline: middle;
	}
	.room-count.none {
		fill: var(--fg3);
		opacity: 0.7;
	}
	.room-group.pressable {
		cursor: pointer;
		outline: none;
	}
	.room-group.pressable:hover .room,
	.room-group.pressable:focus-visible .room {
		fill: color-mix(in srgb, var(--purple) 18%, var(--surface));
		stroke: var(--purple);
	}
	.total {
		position: absolute;
		right: 8px;
		bottom: 6px;
		font-size: var(--text-xs);
		color: var(--fg3);
		text-shadow:
			0 0 8px var(--bg),
			0 0 4px var(--bg);
	}
</style>
