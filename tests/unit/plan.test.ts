import { describe, expect, it } from 'vitest';
import {
	outlinePath,
	roomAreaM2,
	totalAreaM2,
	traceOutlines,
	validateDrawing,
	type PlanRoom
} from '$lib/plan';

const rect = (x: number, y: number, w: number, h: number): [number, number][] => {
	const cells: [number, number][] = [];
	for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push([x + dx, y + dy]);
	return cells;
};

describe('traceOutlines', () => {
	it('a rectangle traces to one four-corner loop', () => {
		const loops = traceOutlines(rect(2, 3, 4, 2));
		expect(loops).toHaveLength(1);
		expect(loops[0]).toHaveLength(4);
		const xs = loops[0].map((p) => p[0]);
		const ys = loops[0].map((p) => p[1]);
		expect(Math.min(...xs)).toBe(2);
		expect(Math.max(...xs)).toBe(6);
		expect(Math.min(...ys)).toBe(3);
		expect(Math.max(...ys)).toBe(5);
	});

	it('an L-shape traces to one six-corner loop', () => {
		const cells = [...rect(0, 0, 4, 2), ...rect(0, 2, 2, 2)];
		const loops = traceOutlines(cells);
		expect(loops).toHaveLength(1);
		expect(loops[0]).toHaveLength(6);
	});

	it('a U-shape traces to one eight-corner loop', () => {
		const cells = [...rect(0, 0, 2, 4), ...rect(4, 0, 2, 4), ...rect(2, 3, 2, 1)];
		const loops = traceOutlines(cells);
		expect(loops).toHaveLength(1);
		expect(loops[0]).toHaveLength(8);
	});

	it('disjoint parts trace to separate loops', () => {
		const cells = [...rect(0, 0, 2, 2), ...rect(5, 5, 3, 1)];
		const loops = traceOutlines(cells);
		expect(loops).toHaveLength(2);
	});

	it('outlinePath produces closed SVG subpaths', () => {
		const path = outlinePath(rect(1, 1, 2, 2), 10);
		expect(path).toMatch(/^M .* Z$/);
		expect(path).toContain('10 10');
	});
});

describe('areas and validation', () => {
	it('area follows the physical cell size', () => {
		const room: PlanRoom = { name: 'Living', cells: rect(0, 0, 8, 6) }; // 48 cells
		expect(roomAreaM2(room, 50)).toBeCloseTo(12, 5); // 48 × 0.25 m²
		expect(roomAreaM2(room, 100)).toBeCloseTo(48, 5);
	});

	it('total area sums the rooms', () => {
		const drawing = validateDrawing({
			cellCm: 50,
			rooms: [
				{ name: 'A', cells: rect(0, 0, 4, 4) },
				{ name: 'B', cells: rect(10, 0, 2, 2) }
			]
		})!;
		expect(totalAreaM2(drawing)).toBeCloseTo(4 + 1, 5);
	});

	it('legacy rectangle rooms convert to cells', () => {
		const drawing = validateDrawing({ rooms: [{ x: 1, y: 1, w: 3, h: 2, name: 'Old' }] })!;
		expect(drawing.cellCm).toBe(10);
		expect(drawing.rooms[0].cells).toHaveLength(6);
	});

	it('rejects garbage and clamps the scale', () => {
		expect(validateDrawing({ rooms: [{ cells: 'nope' }] })).toBeNull();
		expect(validateDrawing({ cellCm: 5, rooms: [] })!.cellCm).toBe(10);
		const dupes = validateDrawing({
			cellCm: 60,
			rooms: [
				{
					name: 'X',
					cells: [
						[1, 1],
						[1, 1],
						[2, 1]
					]
				}
			]
		})!;
		expect(dupes.rooms[0].cells).toHaveLength(2);
		expect(dupes.cellCm).toBe(60);
	});
});

describe('smoothLoop (diagonal walls)', () => {
	it('collapses a unit staircase into one diagonal segment', async () => {
		const { smoothLoop, traceOutlines } = await import('$lib/plan');
		// right triangle: rows of width 4, 3, 2, 1 — hypotenuse is a staircase
		const cells: [number, number][] = [];
		for (let y = 0; y < 4; y++) for (let x = 0; x < 4 - y; x++) cells.push([x, y]);
		const [loop] = traceOutlines(cells);
		const smooth = smoothLoop(loop);
		expect(smooth.length).toBeLessThan(loop.length);
		expect(smooth.length).toBeLessThanOrEqual(5);
	});

	it('leaves large rectilinear steps untouched', async () => {
		const { smoothLoop, traceOutlines } = await import('$lib/plan');
		const cells: [number, number][] = [];
		for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) cells.push([x, y]);
		for (let y = 4; y < 8; y++) for (let x = 0; x < 4; x++) cells.push([x, y]);
		const [loop] = traceOutlines(cells);
		expect(smoothLoop(loop)).toEqual(loop); // an L with 4-cell steps stays an L
	});
});
