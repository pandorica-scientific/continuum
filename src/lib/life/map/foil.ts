// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The gold coating, and taking it off.
 *
 * Ported from the handoff's prototype, which is the version that has been used
 * and looks right. The shape is unchanged on purpose — four canvases, a mask
 * that records what has been removed, a cache of crumbly brush stamps, and a
 * list of flakes stepped by a frame loop.
 *
 * FOUR CANVASES, AND EACH HAS ONE JOB:
 *   foil    the material itself, painted once
 *   mask    where it still is; scratching erases from THIS, not from the foil
 *   relief  the shadow the remaining foil casts onto what it covers
 *   display what is actually on screen, composited from the other three
 *
 * None of this lives in reactive state. A `$state` array of flakes would
 * re-render a component sixty times a second to move some rectangles.
 */
import { FOIL, SCUFF_DARK, SCUFF_LIGHT, SHAVINGS } from './materials';
import {
	CLEARED,
	THIN,
	brushWidth,
	sampleGrid,
	stepsAlong,
	strokePressure,
	strokeWidth
} from './brush';

/** The coordinate space every path and every canvas agrees on. */
const W = 960;
const H = 480;

/** How many pre-baked brush stamps, and how big each is. */
const STAMPS = 10;
const STAMP_SIZE = 34;

/** Dots per stamp, beyond the core disc. This is what makes the edge ragged. */
const STAMP_DOTS = 46;

export interface Cell {
	/** The region's path, in the 960 × 480 space. */
	d: string;
	name: string;
	bounds: [[number, number], [number, number]];
	/** Whether a point in that space falls inside this region. */
	contains: (x: number, y: number) => boolean;
}

export interface Flake {
	x: number;
	y: number;
	vx: number;
	vy: number;
	w: number;
	h: number;
	a: number;
	va: number;
	colour: string;
	life: number;
	t: number;
	settled: boolean;
}

/**
 * A canvas of noise, tiled over the foil.
 *
 * Made once and reused: it is the grain that stops the gradient reading as a
 * flat beige rectangle.
 */
function noiseTile(): HTMLCanvasElement {
	const size = 96;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d')!;
	const image = context.createImageData(size, size);
	for (let i = 0; i < image.data.length; i += 4) {
		const v = 120 + (Math.random() - 0.5) * 150;
		image.data[i] = v;
		image.data[i + 1] = v * 0.94;
		image.data[i + 2] = v * 0.7;
		image.data[i + 3] = 255;
	}
	context.putImageData(image, 0, 0);
	return canvas;
}

/**
 * Ten crumbly stamps: a core disc plus a scatter of dots.
 *
 * Pre-baked because a stroke lays dozens of these a second, and drawing 46
 * circles per stamp at that rate is the difference between a scratch and a
 * slideshow. Ten of them, rotated and jittered at use, is enough that the eye
 * never sees the repeat.
 */
function makeStamps(): HTMLCanvasElement[] {
	return Array.from({ length: STAMPS }, () => {
		const canvas = document.createElement('canvas');
		canvas.width = STAMP_SIZE;
		canvas.height = STAMP_SIZE;
		const context = canvas.getContext('2d')!;
		const r = STAMP_SIZE / 2;

		context.fillStyle = '#fff';
		context.beginPath();
		context.arc(r, r, r * 0.5, 0, 7);
		context.fill();

		for (let i = 0; i < STAMP_DOTS; i++) {
			const angle = Math.random() * 7;
			const away = r * (0.3 + Math.random() * 0.65);
			context.globalAlpha = 0.35 + Math.random() * 0.65;
			context.beginPath();
			context.arc(
				r + Math.cos(angle) * away,
				r + Math.sin(angle) * away,
				1.2 + Math.random() * 3.3,
				0,
				7
			);
			context.fill();
		}
		return canvas;
	});
}

export class Foil {
	private readonly display: CanvasRenderingContext2D;
	private readonly foil: [HTMLCanvasElement, CanvasRenderingContext2D];
	private readonly mask: [HTMLCanvasElement, CanvasRenderingContext2D];
	private readonly relief: [HTMLCanvasElement, CanvasRenderingContext2D];
	private readonly stamps: HTMLCanvasElement[];
	private readonly paths: Path2D[];
	private readonly scale: number;

	private flakes: Flake[] = [];
	private frame = 0;
	private last = 0;
	private stroking = false;

	private readonly brushes = new Map<number, number>();
	private readonly samples = new Map<number, { x: number; y: number }[]>();

	constructor(
		canvas: HTMLCanvasElement,
		private readonly cells: Cell[],
		/** Regions already visited when this opened: they start with no coating. */
		private readonly alreadyClear: Set<number>,
		/** Called when a region crosses the cleared threshold. */
		private readonly onCleared: (index: number, name: string) => void
	) {
		const box = canvas.getBoundingClientRect();
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.scale = ((box.width || W) / W) * dpr;

		const make = (options?: CanvasRenderingContext2DSettings) => {
			const made = document.createElement('canvas');
			made.width = Math.round(W * this.scale);
			made.height = Math.round(H * this.scale);
			const context = made.getContext('2d', options)!;
			context.setTransform(this.scale, 0, 0, this.scale, 0, 0);
			return [made, context] as [HTMLCanvasElement, CanvasRenderingContext2D];
		};

		canvas.width = Math.round(W * this.scale);
		canvas.height = Math.round(H * this.scale);
		this.display = canvas.getContext('2d')!;
		this.display.setTransform(this.scale, 0, 0, this.scale, 0, 0);

		this.foil = make({ willReadFrequently: false });
		// Read back a pixel at a time to ask how much coating is left, which is
		// exactly the access pattern this hint exists for.
		this.mask = make({ willReadFrequently: true });
		this.relief = make();

		this.stamps = makeStamps();
		this.paths = cells.map((cell) => new Path2D(cell.d));

		this.build();
		this.render();
	}

	/** Everywhere still coated: every region except the ones already visited. */
	private coated(): Path2D {
		const path = new Path2D();
		this.paths.forEach((one, index) => {
			if (!this.alreadyClear.has(index)) path.addPath(one);
		});
		return path;
	}

	/** Paint the material once, then clip it to the regions that are covered. */
	private build() {
		const [, f] = this.foil;
		const [, m] = this.mask;

		f.setTransform(this.scale, 0, 0, this.scale, 0, 0);
		f.globalCompositeOperation = 'source-over';
		f.clearRect(0, 0, W, H);

		const gold = f.createLinearGradient(0, 0, W, H);
		gold.addColorStop(0, FOIL[0]);
		gold.addColorStop(0.34, FOIL[1]);
		gold.addColorStop(0.56, FOIL[2]);
		gold.addColorStop(0.8, FOIL[3]);
		gold.addColorStop(1, FOIL[4]);
		f.fillStyle = gold;
		f.fillRect(0, 0, W, H);

		// Brushed grain, raked at a slight angle. Real foil is rolled, and the
		// rolling leaves lines.
		f.save();
		f.translate(W / 2, H / 2);
		f.rotate(-0.24);
		f.translate(-W, -H);
		for (let y = 0; y < 960; y += 1.6) {
			const light = ((0.4 + Math.random() * 0.22) * 100) | 0;
			f.strokeStyle = `hsla(42, 34%, ${light}%, ${(0.06 + Math.random() * 0.16).toFixed(2)})`;
			f.lineWidth = 0.4 + Math.random();
			f.beginPath();
			f.moveTo(0, y);
			f.lineTo(1920, y + (Math.random() - 0.5) * 3);
			f.stroke();
		}
		f.restore();

		const tile = noiseTile();
		f.save();
		f.globalAlpha = 0.1;
		for (let y = 0; y < H; y += 96) for (let x = 0; x < W; x += 96) f.drawImage(tile, x, y, 96, 96);
		f.restore();

		// The sheen across it, which is what says "metal" rather than "tan paper".
		const sheen = f.createLinearGradient(0, 0, W, 300);
		sheen.addColorStop(0, 'rgba(255,255,255,0)');
		sheen.addColorStop(0.44, 'rgba(255,255,255,0.2)');
		sheen.addColorStop(0.53, 'rgba(255,255,255,0.03)');
		sheen.addColorStop(1, 'rgba(255,255,255,0)');
		f.fillStyle = sheen;
		f.fillRect(0, 0, W, H);

		const coated = this.coated();
		f.globalCompositeOperation = 'destination-in';
		f.fillStyle = '#fff';
		f.fill(coated);
		f.globalCompositeOperation = 'source-over';
		f.strokeStyle = 'rgba(46,37,8,0.5)';
		f.lineWidth = 0.9;
		this.paths.forEach((one, index) => {
			if (!this.alreadyClear.has(index)) f.stroke(one);
		});

		m.setTransform(this.scale, 0, 0, this.scale, 0, 0);
		m.globalCompositeOperation = 'source-over';
		m.clearRect(0, 0, W, H);
		m.fillStyle = '#fff';
		m.fill(coated);
	}

	/** How much coating is left at a point, 0 to 1. */
	private coatingAt(x: number, y: number): number {
		const px = Math.max(0, Math.min(Math.round(W * this.scale) - 1, Math.round(x * this.scale)));
		const py = Math.max(0, Math.min(Math.round(H * this.scale) - 1, Math.round(y * this.scale)));
		return this.mask[1].getImageData(px, py, 1, 1).data[3] / 255;
	}

	private brushFor(index: number): number {
		const held = this.brushes.get(index);
		if (held !== undefined) return held;
		const width = brushWidth(
			this.cells[index]?.bounds ?? [
				[0, 0],
				[0, 0]
			]
		);
		this.brushes.set(index, width);
		return width;
	}

	private samplesFor(index: number): { x: number; y: number }[] {
		const held = this.samples.get(index);
		if (held) return held;
		const cell = this.cells[index];
		const found = cell ? sampleGrid(cell.bounds, cell.contains) : [];
		const out = found.length
			? found
			: [
					{
						x: (cell?.bounds[0][0] ?? 0) + 1,
						y: (cell?.bounds[0][1] ?? 0) + 1
					}
				];
		this.samples.set(index, out);
		return out;
	}

	/** One stamp of the brush, plus whatever it throws off. */
	private scratchAt(
		x: number,
		y: number,
		dir: number,
		pressure: number,
		width: number,
		index: number
	) {
		const path = this.paths[index];
		if (!path) return;

		const [, f] = this.foil;
		const [, m] = this.mask;
		const left = this.coatingAt(x + Math.cos(dir) * width * 0.5, y + Math.sin(dir) * width * 0.5);

		// A hairline scuff beside the trail, on foil that is still there.
		if (left > 0.2 && Math.random() < 0.5) {
			f.save();
			f.beginPath();
			f.clip(path);
			f.translate(x, y);
			f.rotate(dir + (Math.random() - 0.5) * 0.5);
			f.strokeStyle = Math.random() < 0.5 ? SCUFF_DARK : SCUFF_LIGHT;
			f.lineWidth = 0.4 + Math.random() * 0.6;
			const length = 6 + Math.random() * 12;
			const off = (Math.random() - 0.5) * width * 1.8;
			f.beginPath();
			f.moveTo(-length / 2, off);
			f.lineTo(length / 2, off + (Math.random() - 0.5) * 2);
			f.stroke();
			f.restore();
		}

		// THE REGION IS LOCKED: every stamp is clipped to the region the stroke
		// began in, so dragging across a border cannot scratch the neighbour.
		m.save();
		m.beginPath();
		m.clip(path);
		m.globalCompositeOperation = 'destination-out';
		m.globalAlpha = Math.min(1, pressure * (0.55 + Math.random() * 0.45));
		const size = width * (0.85 + Math.random() * 0.3);
		m.translate(x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3);
		m.rotate(Math.random() * 7);
		m.drawImage(
			this.stamps[(Math.random() * this.stamps.length) | 0],
			-size / 2,
			-size / 2,
			size,
			size
		);
		m.restore();

		// Shavings only where there was material to remove.
		let count = 0;
		if (left > 0.15 && pressure > 0.4) {
			count = Math.random() < 0.6 * left + 0.2 ? 1 : left > 0.6 ? 2 : 0;
		}
		for (let i = 0; i < count; i++) {
			const spread = (Math.random() - 0.5) * 1.8;
			const speed = (60 + Math.random() * 140) * pressure;
			this.flakes.push({
				x: x + (Math.random() - 0.5) * width,
				y: y + (Math.random() - 0.5) * width,
				vx: Math.cos(dir + spread) * speed + (Math.random() - 0.5) * 60,
				vy: Math.sin(dir + spread) * speed * 0.5 - (40 + Math.random() * 120),
				w: 1.5 + Math.random() * 3,
				h: 0.8 + Math.random() * 1.4,
				a: Math.random() * 7,
				va: (Math.random() - 0.5) * 28,
				colour: SHAVINGS[(Math.random() * SHAVINGS.length) | 0],
				life: 0.9 + Math.random() * 0.9,
				t: 0,
				settled: false
			});
		}
	}

	/** Take a region's coating away entirely, once it counts as cleared. */
	private punch(index: number) {
		const path = this.paths[index];
		if (!path) return;
		for (const [, context] of [this.mask, this.foil]) {
			context.save();
			context.globalCompositeOperation = 'destination-out';
			context.fillStyle = '#000';
			context.fill(path);
			context.restore();
		}
	}

	private checkCleared(index: number) {
		if (this.alreadyClear.has(index)) return;
		const points = this.samplesFor(index);
		if (points.length === 0) return;

		let clear = 0;
		for (const point of points) if (this.coatingAt(point.x, point.y) < THIN) clear++;
		if (clear / points.length < CLEARED) return;

		this.alreadyClear.add(index);
		this.punch(index);
		this.onCleared(index, this.cells[index]?.name ?? '');
	}

	private stepFlakes(dt: number) {
		for (let i = this.flakes.length - 1; i >= 0; i--) {
			const flake = this.flakes[i];
			flake.t += dt;
			if (!flake.settled) {
				flake.vy += 620 * dt;
				flake.vx *= 1 - 2.2 * dt;
				flake.x += flake.vx * dt;
				flake.y += flake.vy * dt;
				flake.a += flake.va * dt;
				// They land at the bottom edge and lie there rather than falling
				// out of the world.
				if (flake.y > H - 6) {
					flake.y = H - 6;
					flake.settled = true;
					flake.life = 2.5 + Math.random() * 2;
					flake.t = 0;
				}
			}
			if (flake.t > flake.life) this.flakes.splice(i, 1);
		}
	}

	/** Composite the three working canvases onto the one on screen. */
	private render() {
		const d = this.display;
		d.setTransform(this.scale, 0, 0, this.scale, 0, 0);
		d.globalCompositeOperation = 'source-over';
		d.clearRect(0, 0, W, H);

		d.drawImage(this.foil[0], 0, 0, W, H);
		d.globalCompositeOperation = 'destination-in';
		d.drawImage(this.mask[0], 0, 0, W, H);

		// The remaining foil casts a shadow onto what it covers, so a
		// half-scratched region reads as a torn film rather than as a hole.
		const [, r] = this.relief;
		r.setTransform(this.scale, 0, 0, this.scale, 0, 0);
		r.globalCompositeOperation = 'source-over';
		r.clearRect(0, 0, W, H);
		r.save();
		r.shadowColor = 'rgba(0,0,0,0.45)';
		r.shadowBlur = 3;
		r.shadowOffsetX = 1;
		r.shadowOffsetY = 1.5;
		r.drawImage(this.mask[0], 0, 0, W, H);
		r.restore();
		r.globalCompositeOperation = 'destination-out';
		r.drawImage(this.mask[0], 0, 0, W, H);

		d.globalCompositeOperation = 'destination-over';
		d.drawImage(this.relief[0], 0, 0, W, H);

		d.globalCompositeOperation = 'source-over';
		for (const flake of this.flakes) {
			const fade = 1 - Math.pow(flake.t / flake.life, flake.settled ? 3 : 4);
			d.save();
			d.globalAlpha = Math.max(0, fade);
			d.translate(flake.x, flake.y);
			d.rotate(flake.a);
			d.fillStyle = flake.colour;
			d.fillRect(-flake.w / 2, -flake.h / 2, flake.w, flake.h);
			d.fillStyle = 'rgba(255,248,222,0.5)';
			d.fillRect(-flake.w / 2, -flake.h / 2, flake.w, flake.h * 0.35);
			d.restore();
		}
	}

	/** Run frames while there is anything moving, and stop when there is not. */
	private wake() {
		if (this.frame) return;
		this.last = performance.now();
		const loop = (now: number) => {
			const dt = Math.min(0.05, (now - this.last) / 1000);
			this.last = now;
			this.stepFlakes(dt);
			this.render();
			this.frame = this.flakes.length || this.stroking ? requestAnimationFrame(loop) : 0;
		};
		this.frame = requestAnimationFrame(loop);
	}

	/** Which region a point is in, or null for the sea. */
	cellAt(x: number, y: number): number | null {
		for (let i = 0; i < this.paths.length; i++) {
			if (this.mask[1].isPointInPath(this.paths[i], x * this.scale, y * this.scale)) return i;
		}
		return null;
	}

	// ---- The stroke ----

	private locked: number | null = null;
	private from: [number, number] = [0, 0];
	private at = 0;
	private since = 0;

	begin(x: number, y: number): boolean {
		const index = this.cellAt(x, y);
		if (index === null) return false;

		this.stroking = true;
		this.locked = index;
		this.from = [x, y];
		this.at = performance.now();
		this.since = 0;
		this.scratchAt(x, y, 0, 0.8, this.brushFor(index), index);
		this.wake();
		return true;
	}

	move(x: number, y: number) {
		if (!this.stroking || this.locked === null) return;
		const index = this.locked;
		const base = this.brushFor(index);

		const dx = x - this.from[0];
		const dy = y - this.from[1];
		const distance = Math.hypot(dx, dy);
		if (distance < 0.6) return;

		const now = performance.now();
		const pressure = strokePressure(distance, now - this.at);
		const width = strokeWidth(base, distance, now - this.at);
		const dir = Math.atan2(dy, dx);

		// Interpolated, so a fast drag leaves a scratch rather than a dotted line.
		const steps = stepsAlong(distance, base);
		for (let step = 1; step <= steps; step++) {
			const q = step / steps;
			this.scratchAt(this.from[0] + dx * q, this.from[1] + dy * q, dir, pressure, width, index);
		}

		this.from = [x, y];
		this.at = now;
		this.since += steps;
		// Reading the mask back is the expensive part, so it is asked every
		// couple of dozen stamps rather than every one.
		if (this.since > 26) {
			this.since = 0;
			this.checkCleared(index);
		}
		this.wake();
	}

	end() {
		if (!this.stroking) return;
		this.stroking = false;
		const index = this.locked;
		this.locked = null;
		if (index !== null) this.checkCleared(index);
		this.wake();
	}

	/** Take a region's coating off without a stroke — for the reveal. */
	clear(index: number) {
		if (this.alreadyClear.has(index)) return;
		this.alreadyClear.add(index);
		this.punch(index);
		this.render();
	}

	destroy() {
		cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.flakes = [];
	}
}
