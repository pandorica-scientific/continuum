// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// A drawn floor plan with physical scale: rooms are sets of grid cells (any
// rectilinear shape — L, U, T — emerges from painting cells), and one setting
// gives the grid its physical meaning: the cell size in centimetres. Areas
// and dimensions derive from that; nothing else is configured.

export interface PlanRoom {
	name: string;
	/** grid cells as [x, y] pairs */
	cells: [number, number][];
}

export interface PlanDrawing {
	/** physical size of one grid cell in centimetres */
	cellCm: number;
	rooms: PlanRoom[];
}

// 120 × 74 cells at the 10 cm default = 12 m × 7.4 m of flat; raise the cell
// size for larger homes.
export const PLAN_COLS = 120;
export const PLAN_ROWS = 74;
export const DEFAULT_CELL_CM = 10;

interface LegacyRoom {
	x: number;
	y: number;
	w: number;
	h: number;
	name: string;
}

/**
 * Expand a legacy rectangle, or null if it does not fit the grid. The bound is
 * not cosmetic: without it `w * h` tuples are allocated straight from a request
 * body, and a two-field rectangle is enough to exhaust the heap.
 */
function rectToCells(room: LegacyRoom): [number, number][] | null {
	if (room.w < 1 || room.h < 1) return null;
	if (room.x < 0 || room.y < 0) return null;
	if (room.x + room.w > PLAN_COLS || room.y + room.h > PLAN_ROWS) return null;
	const cells: [number, number][] = [];
	for (let dy = 0; dy < room.h; dy++) {
		for (let dx = 0; dx < room.w; dx++) {
			cells.push([room.x + dx, room.y + dy]);
		}
	}
	return cells;
}

export function validateDrawing(raw: unknown): PlanDrawing | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const data = raw as { rooms?: unknown; cellCm?: unknown };
	if (!Array.isArray(data.rooms) || data.rooms.length > 60) return null;
	const cellCm =
		Number.isFinite(Number(data.cellCm)) && Number(data.cellCm) >= 10 && Number(data.cellCm) <= 200
			? Number(data.cellCm)
			: DEFAULT_CELL_CM;

	const rooms: PlanRoom[] = [];
	for (const roomRaw of data.rooms) {
		if (typeof roomRaw !== 'object' || roomRaw === null) return null;
		const room = roomRaw as Record<string, unknown>;
		let cells: [number, number][];
		if (Array.isArray(room.cells)) {
			const seen = new Set<string>();
			cells = [];
			for (const cell of room.cells) {
				if (!Array.isArray(cell) || cell.length !== 2) return null;
				const [x, y] = cell;
				if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
				if (x < 0 || x >= PLAN_COLS || y < 0 || y >= PLAN_ROWS) continue;
				const key = `${x},${y}`;
				if (seen.has(key)) continue;
				seen.add(key);
				cells.push([x, y]);
			}
		} else if ([room.x, room.y, room.w, room.h].every((v) => Number.isInteger(v))) {
			// legacy rectangle format from the first editor version
			const rect = rectToCells(room as unknown as LegacyRoom);
			if (!rect) return null;
			cells = rect;
		} else {
			return null;
		}
		if (cells.length === 0) continue;
		rooms.push({
			name: String(room.name ?? '')
				.slice(0, 40)
				.trim(),
			cells
		});
	}
	return { cellCm, rooms };
}

/** Room area in m² under the plan's scale. */
export function roomAreaM2(room: PlanRoom, cellCm: number): number {
	return room.cells.length * Math.pow(cellCm / 100, 2);
}

export function totalAreaM2(drawing: PlanDrawing): number {
	return drawing.rooms.reduce((sum, room) => sum + roomAreaM2(room, drawing.cellCm), 0);
}

/** Bounding box of a room's cells, for label placement. */
export function roomBounds(room: PlanRoom): { x: number; y: number; w: number; h: number } {
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const [x, y] of room.cells) {
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
	}
	return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Trace the outline(s) of a cell union as closed loops of grid vertices.
 * Boundary edges are directed so the outer loop runs clockwise in screen
 * coordinates; at pinch points the tracer prefers the tightest right turn,
 * keeping loops simple. Collinear points are merged.
 */
export function traceOutlines(cells: [number, number][]): [number, number][][] {
	const inRoom = new Set(cells.map(([x, y]) => `${x},${y}`));
	type Edge = { from: [number, number]; to: [number, number] };
	const edges: Edge[] = [];
	for (const [x, y] of cells) {
		if (!inRoom.has(`${x},${y - 1}`)) edges.push({ from: [x, y], to: [x + 1, y] });
		if (!inRoom.has(`${x + 1},${y}`)) edges.push({ from: [x + 1, y], to: [x + 1, y + 1] });
		if (!inRoom.has(`${x},${y + 1}`)) edges.push({ from: [x + 1, y + 1], to: [x, y + 1] });
		if (!inRoom.has(`${x - 1},${y}`)) edges.push({ from: [x, y + 1], to: [x, y] });
	}

	const byStart = new Map<string, Edge[]>();
	for (const edge of edges) {
		const key = `${edge.from[0]},${edge.from[1]}`;
		if (!byStart.has(key)) byStart.set(key, []);
		byStart.get(key)!.push(edge);
	}

	const loops: [number, number][][] = [];
	const used = new Set<Edge>();
	for (const start of edges) {
		if (used.has(start)) continue;
		const loop: [number, number][] = [];
		let edge = start;
		while (!used.has(edge)) {
			used.add(edge);
			loop.push(edge.from);
			const candidates = (byStart.get(`${edge.to[0]},${edge.to[1]}`) ?? []).filter(
				(e) => !used.has(e)
			);
			if (candidates.length === 0) break;
			if (candidates.length === 1) {
				edge = candidates[0];
			} else {
				// pinch point: prefer the tightest right turn relative to travel
				const dir = [edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]];
				const score = (e: Edge) => {
					const nd = [e.to[0] - e.from[0], e.to[1] - e.from[1]];
					const cross = dir[0] * nd[1] - dir[1] * nd[0];
					const dot = dir[0] * nd[0] + dir[1] * nd[1];
					if (cross > 0) return 0; // right turn (screen coords, y down)
					if (dot > 0) return 1; // straight
					return 2; // left turn
				};
				edge = candidates.sort((a, b) => score(a) - score(b))[0];
			}
		}
		// merge collinear vertices
		const merged = loop.filter((point, i) => {
			const prev = loop[(i - 1 + loop.length) % loop.length];
			const next = loop[(i + 1) % loop.length];
			const d1 = [point[0] - prev[0], point[1] - prev[1]];
			const d2 = [next[0] - point[0], next[1] - point[1]];
			return d1[0] * d2[1] - d1[1] * d2[0] !== 0;
		});
		if (merged.length >= 4) loops.push(merged);
	}
	return loops;
}

/**
 * Replace staircases of single-cell steps with straight diagonals — a sloped
 * wall painted at 10 cm resolution renders as the line it means. Runs of
 * consecutive unit-length segments alternating direction collapse to one
 * segment from the run's first corner to its last.
 */
export function smoothLoop(loop: [number, number][]): [number, number][] {
	const n = loop.length;
	if (n < 4) return loop;
	const segLen = (i: number) => {
		const a = loop[i];
		const b = loop[(i + 1) % n];
		return Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
	};
	// mark vertices interior to a staircase: both adjacent segments are unit
	const drop = loop.map((_, i) => {
		const prev = (i - 1 + n) % n;
		return segLen(prev) === 1 && segLen(i) === 1;
	});
	const kept = loop.filter((_, i) => !drop[i]);
	return kept.length >= 3 ? kept : loop;
}

/** SVG path for a room outline at a given cell pixel size. */
export function outlinePath(cells: [number, number][], cell: number, smooth = true): string {
	return traceOutlines(cells)
		.map((loop) => (smooth ? smoothLoop(loop) : loop))
		.map((loop) => 'M ' + loop.map(([x, y]) => `${x * cell} ${y * cell}`).join(' L ') + ' Z')
		.join(' ');
}
