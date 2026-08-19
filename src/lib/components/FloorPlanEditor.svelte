<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { submitAction } from '$lib/actions/result';
	import {
		DEFAULT_CELL_CM,
		outlinePath,
		PLAN_COLS,
		PLAN_ROWS,
		roomAreaM2,
		roomBounds,
		totalAreaM2,
		type PlanDrawing,
		type PlanRoom
	} from '$lib/plan';

	let {
		propertyId,
		initial,
		onclose
	}: { propertyId: string; initial: PlanDrawing | null; onclose: () => void } = $props();

	const CELL = 10;

	let cellCm = $state(initial?.cellCm ?? DEFAULT_CELL_CM);
	let rooms: PlanRoom[] = $state(
		initial
			? initial.rooms.map((r) => ({
					name: r.name,
					cells: r.cells.map((c) => [...c] as [number, number])
				}))
			: []
	);
	let mode: 'new' | 'extend' | 'erase' = $state('new');
	let selected: number | null = $state(null);
	let draft: { x: number; y: number; w: number; h: number } | null = $state(null);
	let dragStart: { x: number; y: number } | null = null;
	let dragged = false;
	let svgEl: SVGSVGElement | undefined = $state();
	let nameInput: HTMLInputElement | undefined = $state();
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	const drawing = $derived({ cellCm, rooms } as PlanDrawing);
	const draftMeters = $derived.by(() => {
		const d = draft;
		if (!d) return null;
		return `${((d.w * cellCm) / 100).toFixed(1)} × ${((d.h * cellCm) / 100).toFixed(1)} m`;
	});

	function cellAt(event: PointerEvent | MouseEvent): { x: number; y: number } {
		const rect = svgEl!.getBoundingClientRect();
		const scaleX = (PLAN_COLS * CELL) / rect.width;
		const scaleY = (PLAN_ROWS * CELL) / rect.height;
		return {
			x: Math.max(
				0,
				Math.min(PLAN_COLS - 1, Math.floor(((event.clientX - rect.left) * scaleX) / CELL))
			),
			y: Math.max(
				0,
				Math.min(PLAN_ROWS - 1, Math.floor(((event.clientY - rect.top) * scaleY) / CELL))
			)
		};
	}

	function roomAt(x: number, y: number): number | null {
		for (let i = rooms.length - 1; i >= 0; i--) {
			if (rooms[i].cells.some(([cx, cy]) => cx === x && cy === y)) return i;
		}
		return null;
	}

	function draftCells(): [number, number][] {
		if (!draft) return [];
		const cells: [number, number][] = [];
		for (let dy = 0; dy < draft.h; dy++) {
			for (let dx = 0; dx < draft.w; dx++) {
				cells.push([draft.x + dx, draft.y + dy]);
			}
		}
		return cells;
	}

	function down(event: PointerEvent) {
		(event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
		const cell = cellAt(event);
		dragStart = cell;
		dragged = false;
		draft = { x: cell.x, y: cell.y, w: 1, h: 1 };
	}

	function move(event: PointerEvent) {
		if (!dragStart) return;
		const cell = cellAt(event);
		if (cell.x !== dragStart.x || cell.y !== dragStart.y) dragged = true;
		draft = {
			x: Math.min(dragStart.x, cell.x),
			y: Math.min(dragStart.y, cell.y),
			w: Math.abs(cell.x - dragStart.x) + 1,
			h: Math.abs(cell.y - dragStart.y) + 1
		};
	}

	function up() {
		const swept = draftCells();
		const clickOnly = !dragged;
		if (clickOnly && dragStart) {
			const hit = roomAt(dragStart.x, dragStart.y);
			if (mode === 'erase') {
				// a click chips away a single cell — how slopes get sculpted
				if (hit !== null) {
					rooms[hit].cells = rooms[hit].cells.filter(
						([x, y]) => !(x === dragStart!.x && y === dragStart!.y)
					);
					if (rooms[hit].cells.length === 0) {
						rooms.splice(hit, 1);
						selected = null;
					}
				}
			} else if (mode === 'extend' && selected !== null && hit === null && rooms[selected]) {
				// a click adds a single cell to the selected room
				rooms[selected].cells.push([dragStart.x, dragStart.y]);
			} else {
				// plain click selects the room under the pointer
				selected = hit;
				if (selected !== null && mode === 'new') mode = 'extend';
				if (selected === null && mode === 'extend') mode = 'new';
			}
		} else if (mode === 'erase') {
			const sweptKeys = new Set(swept.map(([x, y]) => `${x},${y}`));
			for (const room of rooms) {
				room.cells = room.cells.filter(([x, y]) => !sweptKeys.has(`${x},${y}`));
			}
			for (let i = rooms.length - 1; i >= 0; i--) {
				if (rooms[i].cells.length === 0) rooms.splice(i, 1);
			}
			selected = null;
		} else if (mode === 'extend' && selected !== null && rooms[selected]) {
			const existing = new Set(rooms[selected].cells.map(([x, y]) => `${x},${y}`));
			// never steal cells from other rooms
			const taken = new Set(
				rooms.flatMap((room, i) => (i === selected ? [] : room.cells.map(([x, y]) => `${x},${y}`)))
			);
			for (const [x, y] of swept) {
				const key = `${x},${y}`;
				if (!existing.has(key) && !taken.has(key)) rooms[selected].cells.push([x, y]);
			}
		} else {
			// new room from the swept cells not already claimed
			const taken = new Set(rooms.flatMap((room) => room.cells.map(([x, y]) => `${x},${y}`)));
			const cells = swept.filter(([x, y]) => !taken.has(`${x},${y}`));
			if (cells.length > 1) {
				rooms.push({ name: `Room ${rooms.length + 1}`, cells });
				selected = rooms.length - 1;
				mode = 'extend'; // the natural next drag grows this room
			}
		}
		draft = null;
		dragStart = null;
	}

	function nameRoom(event: MouseEvent) {
		// double-click a room to go straight to naming it
		const cell = cellAt(event);
		const hit = roomAt(cell.x, cell.y);
		if (hit === null) return;
		selected = hit;
		if (mode === 'new') mode = 'extend';
		requestAnimationFrame(() => {
			nameInput?.focus();
			nameInput?.select();
		});
	}

	async function save() {
		saving = true;
		saveError = null;
		try {
			const body = new FormData();
			body.set('propertyId', propertyId);
			body.set('drawing', JSON.stringify({ cellCm, rooms }));
			const outcome = await submitAction('/property?/savePlan', body);
			if (outcome.type === 'success') onclose();
			else saveError = outcome.message;
		} finally {
			saving = false;
		}
	}
</script>

<div class="editor">
	<div class="modes">
		<div class="seg">
			<button type="button" class:active={mode === 'new'} onclick={() => (mode = 'new')}>
				New room
			</button>
			<button
				type="button"
				class:active={mode === 'extend'}
				disabled={selected === null}
				onclick={() => (mode = 'extend')}
			>
				Extend selected
			</button>
			<button type="button" class:active={mode === 'erase'} onclick={() => (mode = 'erase')}>
				Erase
			</button>
		</div>
		<label class="scale">
			<span>Grid cell</span>
			<input type="number" min="10" max="200" step="5" bind:value={cellCm} class="mono" />
			<span>cm — drags read in real metres</span>
		</label>
	</div>
	<div class="hint">
		{mode === 'erase'
			? 'Drag to erase cells — single clicks chip corners into slopes'
			: mode === 'extend'
				? 'Drag to grow the selected room — an L-shape is just a second drag'
				: 'Drag to draw a room'} · click a room to select it · double-click to name it
		{#if draftMeters}<span class="mono dims">{draftMeters}</span>{/if}
	</div>
	<svg
		bind:this={svgEl}
		viewBox="0 0 {PLAN_COLS * CELL} {PLAN_ROWS * CELL}"
		role="application"
		aria-label="Floor plan editor"
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		ondblclick={nameRoom}
	>
		<defs>
			<pattern id="grid" width={CELL} height={CELL} patternUnits="userSpaceOnUse">
				<path d="M {CELL} 0 L 0 0 0 {CELL}" fill="none" class="gridline" />
			</pattern>
			<pattern id="metre" width={CELL * 10} height={CELL * 10} patternUnits="userSpaceOnUse">
				<path d="M {CELL * 10} 0 L 0 0 0 {CELL * 10}" fill="none" class="metreline" />
			</pattern>
		</defs>
		<rect width={PLAN_COLS * CELL} height={PLAN_ROWS * CELL} fill="url(#grid)" />
		<rect width={PLAN_COLS * CELL} height={PLAN_ROWS * CELL} fill="url(#metre)" />
		{#each rooms as room, i (i)}
			<path
				d={outlinePath(room.cells, CELL)}
				class="room"
				class:selected={selected === i}
				fill-rule="evenodd"
			/>
			{#if room.name && room.cells.length}
				{@const bounds = roomBounds(room)}
				<text
					x={(bounds.x + bounds.w / 2) * CELL}
					y={(bounds.y + bounds.h / 2) * CELL - 12}
					class="room-name"
				>
					{room.name}
				</text>
				<text
					x={(bounds.x + bounds.w / 2) * CELL}
					y={(bounds.y + bounds.h / 2) * CELL + 16}
					class="room-area mono"
				>
					{roomAreaM2(room, cellCm).toFixed(1)} m²
				</text>
			{/if}
		{/each}
		{#if draft}
			<rect
				x={draft.x * CELL}
				y={draft.y * CELL}
				width={draft.w * CELL}
				height={draft.h * CELL}
				class="draft"
				class:erasing={mode === 'erase'}
			/>
		{/if}
	</svg>

	<div class="toolbar">
		{#if selected !== null && rooms[selected]}
			<label class="name-label">
				<span>Selected room</span>
				<input
					class="name-input"
					bind:this={nameInput}
					bind:value={rooms[selected].name}
					placeholder="e.g. Living room"
					aria-label="Room name"
				/>
			</label>
			<button
				type="button"
				class="btn"
				onclick={() => {
					rooms.splice(selected!, 1);
					selected = null;
					mode = 'new';
				}}
			>
				Remove room
			</button>
		{:else}
			<span class="quiet">{rooms.length} room{rooms.length === 1 ? '' : 's'}</span>
		{/if}
		<span class="quiet mono">{totalAreaM2(drawing).toFixed(1)} m² total</span>
		<span class="spacer"></span>
		<button type="button" class="btn" onclick={onclose}>Cancel</button>
		<button type="button" class="btn btn-primary" disabled={saving} onclick={save}>
			{saving ? 'Saving…' : 'Save plan'}
		</button>
	</div>
	{#if saveError}<p class="save-error" role="alert">{saveError}</p>{/if}
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.modes {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
	}
	.seg {
		display: flex;
		gap: 6px;
		border: 1px solid var(--bd);
		border-radius: 8px;
		padding: 3px;
		background: var(--card);
	}
	.seg button {
		border: 0;
		background: transparent;
		color: var(--fg3);
		border-radius: 6px;
		padding: 6px 12px;
		font-size: 12.5px;
		cursor: pointer;
	}
	.seg button.active {
		background: var(--card3);
		color: var(--fg1);
	}
	.seg button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.scale {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--fg3);
	}
	.scale input {
		width: 64px;
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 6px 9px;
		font-size: 12.5px;
	}
	.hint {
		font-size: 12px;
		color: var(--fg3);
		display: flex;
		gap: 12px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	.dims {
		color: var(--fg1);
		font-size: 12px;
	}
	svg {
		width: 100%;
		height: auto;
		display: block;
		border: 1px solid var(--bd);
		border-radius: 8px;
		background: var(--card);
		touch-action: none;
		cursor: crosshair;
	}
	.gridline {
		stroke: var(--bd);
		stroke-width: 0.3;
	}
	.metreline {
		stroke: var(--bd2);
		stroke-width: 0.5;
	}
	.room {
		fill: var(--card2);
		stroke: var(--fg2);
		stroke-width: 1.5;
	}
	.room.selected {
		stroke: var(--blue);
		stroke-width: 2;
	}
	.room-name {
		fill: var(--fg1);
		font-size: 22px;
		font-family: var(--font-sans);
		text-anchor: middle;
		dominant-baseline: middle;
		pointer-events: none;
	}
	.room-area {
		fill: var(--fg3);
		font-size: 16px;
		text-anchor: middle;
		dominant-baseline: middle;
		pointer-events: none;
	}
	.draft {
		fill: var(--blue-tint);
		stroke: var(--blue);
		stroke-width: 1.5;
		stroke-dasharray: 4 3;
	}
	.draft.erasing {
		fill: var(--red-tint);
		stroke: var(--red);
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.save-error {
		margin: 0;
		color: var(--red);
		font-size: 12px;
	}
	.name-label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--fg3);
	}
	.name-input {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 7px 11px;
		font-size: 13px;
	}
	.quiet {
		font-size: 12.5px;
		color: var(--fg3);
	}
	.spacer {
		flex: 1;
	}
</style>
