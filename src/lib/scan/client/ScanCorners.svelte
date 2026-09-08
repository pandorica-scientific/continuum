<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Handles on the photograph, for when the detector was wrong.
	//
	// ScanPagePreview's own comment used to argue this screen should not exist:
	// "dragging four handles on a phone is worse than taking the photo again",
	// made safe by Original as a recovery. Two things overturned it. Original is
	// not a recovery for a page you need CROPPED — it hands back the desk as
	// well. And retaking does not help when detection fails for a reason the
	// photograph cannot fix: a card too small in frame, an object with a strong
	// band across it, a page the same brightness as the table. Those are not bad
	// photographs, and they were unrecoverable.
	//
	// So this is the floor under the detector. However well it does, a person can
	// always say where the page actually is.

	import {
		fullFrameCorners,
		orderCorners,
		type Corners,
		type Outline,
		type Point
	} from '../core/index.ts';

	let {
		imageUrl,
		width,
		height,
		outline = null,
		onapply,
		oncancel,
		onunavailable
	}: {
		/** The photograph, UNCROPPED — the whole frame the corners are measured in. */
		imageUrl: string;
		/** The frame's dimensions, and so the coordinate space of `corners`. */
		width: number;
		height: number;
		/** Where the detector put the boundary, or null when it found nothing. */
		outline?: Outline | null;
		onapply: (outline: Outline) => void;
		oncancel: () => void;
		/**
		 * The picture would not load.
		 *
		 * Normally this screen draws on the phone's OWN copy of the photograph,
		 * which costs no network at all. That copy is absent for a page already
		 * kept, and unreadable when it is a HEIC this browser will not decode —
		 * an iPhone photographing anything at default settings. Either way the
		 * handles would sit over a blank rectangle, so the caller is told and
		 * points this at the server's downscaled original instead.
		 */
		onunavailable?: () => void;
	} = $props();

	type Corner = keyof Corners;
	type Edge = 'top' | 'right' | 'bottom' | 'left';
	type Handle = Corner | Edge;

	const CORNERS: Corner[] = ['tl', 'tr', 'br', 'bl'];
	const EDGES: Edge[] = ['top', 'right', 'bottom', 'left'];
	/** Which two corners each edge runs between, in the order the model reads it. */
	const ENDS: Record<Edge, [Corner, Corner]> = {
		top: ['tl', 'tr'],
		right: ['tr', 'br'],
		bottom: ['br', 'bl'],
		left: ['bl', 'tl']
	};
	const LABELS: Record<Handle, string> = {
		tl: 'Top left',
		tr: 'Top right',
		br: 'Bottom right',
		bl: 'Bottom left',
		top: 'Top edge',
		right: 'Right edge',
		bottom: 'Bottom edge',
		left: 'Left edge'
	};

	/**
	 * How many points a bent edge is handed to the model as.
	 *
	 * The handle is ONE point, but the boundary is stored as a polyline and the
	 * dewarp follows it literally — so handing over the single point would fold
	 * the edge into a tent rather than bending it into a curve. Sampling the
	 * same curve the screen draws keeps what is rendered and what is shown the
	 * same thing.
	 */
	const CURVE_POINTS = 5;

	/**
	 * How close to straight counts as straight, as a share of the edge's length.
	 *
	 * Without this an edge could never be put back: every drag leaves a bend, and
	 * a page that is actually flat would carry four tiny curves for ever.
	 */
	const STRAIGHT_ENOUGH = 0.012;

	/**
	 * A quad to start from when the detector found nothing.
	 *
	 * Deliberately NOT the full frame. Handles sitting exactly on the edges are
	 * half off-screen and read as "nothing to drag"; inset, the shape says at a
	 * glance that it is a box you are meant to move.
	 */
	function startingQuad(): Corners {
		if (outline) return outline.corners;
		const inset = 0.12;
		const x0 = width * inset;
		const x1 = width * (1 - inset);
		const y0 = height * inset;
		const y1 = height * (1 - inset);
		return {
			tl: { x: x0, y: y0 },
			tr: { x: x1, y: y0 },
			br: { x: x1, y: y1 },
			bl: { x: x0, y: y1 }
		};
	}

	/**
	 * Where each edge bends, or null for a straight one.
	 *
	 * One point per edge rather than a list: a sheet of paper bows, it does not
	 * ripple, and one control point is what a person can actually place. The
	 * model accepts as many as anyone cares to give it.
	 */
	function startingBends(): Record<Edge, Point | null> {
		const from = outline?.edges;
		const midOf = (points: Point[] | undefined) =>
			points && points.length ? points[Math.floor(points.length / 2)] : null;
		return {
			top: midOf(from?.top),
			right: midOf(from?.right),
			bottom: midOf(from?.bottom),
			left: midOf(from?.left)
		};
	}

	// The detector's answer is the STARTING point, read once. Later changes to
	// `outline` are this component's own doing, echoed back by the parent, and
	// following them would fight the hand that is dragging.
	let quad = $state<Corners>(startingQuad());
	let bends = $state<Record<Edge, Point | null>>(startingBends());
	let dragging = $state<Handle | null>(null);
	let selected = $state<Handle>('tl');
	let overlay: SVGSVGElement | undefined = $state();

	/**
	 * Hit target and drawn dot are different sizes on purpose. A 44px target is
	 * the smallest a thumb reliably lands on; a 44px DOT would cover the corner
	 * it is meant to be placing. Both are in frame units, so they stay the same
	 * physical size whatever the photograph's resolution.
	 */
	const unit = $derived(Math.max(width, height) / 100);
	const dotRadius = $derived(unit * 1.5);
	const grabRadius = $derived(unit * 5);
	const stroke = $derived(unit * 0.42);

	const clamp = (value: number, high: number) => Math.min(high, Math.max(0, value));

	/**
	 * Screen pixels to frame units, through the overlay's own transform.
	 *
	 * Not measured off the container. Sizing a box to the photograph's aspect
	 * ratio and reading its rect looks simpler and was wrong: an aspect-ratio box
	 * with `place-items: center` resolves its width from max-content, so on a
	 * tall photograph it grew past the screen and took the bottom corners off the
	 * side with it. The image is now letterboxed by `object-fit: contain` and the
	 * overlay by `preserveAspectRatio`, which are defined to produce the SAME
	 * rectangle — and `getScreenCTM` reports exactly what the browser did, so the
	 * handles land on the picture whatever shape the screen is.
	 */
	function toFrame(event: PointerEvent): Point | null {
		const matrix = overlay?.getScreenCTM();
		if (!matrix) return null;
		const at = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
		return { x: clamp(at.x, width), y: clamp(at.y, height) };
	}

	function grab(handle: Handle, event: PointerEvent) {
		event.preventDefault();
		dragging = handle;
		selected = handle;
		(event.currentTarget as Element).setPointerCapture(event.pointerId);
	}

	/** The chord midpoint of an edge: where its handle rests when it is straight. */
	function chordMid(edge: Edge): Point {
		const [a, b] = ENDS[edge];
		return { x: (quad[a].x + quad[b].x) / 2, y: (quad[a].y + quad[b].y) / 2 };
	}

	/** Where an edge's handle actually sits. */
	function handleAt(handle: Handle): Point {
		if (handle in quad) return quad[handle as Corner];
		const edge = handle as Edge;
		return bends[edge] ?? chordMid(edge);
	}

	function move(event: PointerEvent) {
		if (!dragging) return;
		const at = toFrame(event);
		if (!at) return;
		if (dragging in quad) {
			quad = { ...quad, [dragging]: at };
			return;
		}
		const edge = dragging as Edge;
		const [a, b] = ENDS[edge];
		const span = Math.hypot(quad[b].x - quad[a].x, quad[b].y - quad[a].y);
		const mid = chordMid(edge);
		// Dragged back onto the chord, the edge becomes straight again rather
		// than keeping a bend too small to see but large enough to warp with.
		const straight = Math.hypot(at.x - mid.x, at.y - mid.y) < span * STRAIGHT_ENOUGH;
		bends = { ...bends, [edge]: straight ? null : at };
	}

	function release(event: PointerEvent) {
		if (!dragging) return;
		(event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
		dragging = null;
	}

	/** Arrow keys nudge the selected corner: the whole screen is unusable without
	 *  a pointer otherwise, and a fine adjustment is easier this way regardless. */
	function nudge(handle: Handle, event: KeyboardEvent) {
		const step = event.shiftKey ? unit * 4 : unit;
		const by: Record<string, Point> = {
			ArrowLeft: { x: -step, y: 0 },
			ArrowRight: { x: step, y: 0 },
			ArrowUp: { x: 0, y: -step },
			ArrowDown: { x: 0, y: step }
		};
		const delta = by[event.key];
		if (!delta) return;
		event.preventDefault();
		selected = handle;
		const from = handleAt(handle);
		const to = { x: clamp(from.x + delta.x, width), y: clamp(from.y + delta.y, height) };
		if (handle in quad) {
			quad = { ...quad, [handle]: to };
			return;
		}
		// Nudging an edge bends it, which also means the keyboard can reach the
		// curve at all — the whole screen is unusable without arrow keys on a
		// laptop, and that applies to the new handles exactly as it did the old.
		bends = { ...bends, [handle as Edge]: to };
	}

	/**
	 * The control point of a quadratic that PASSES THROUGH the handle.
	 *
	 * A Bézier's control point is not on its curve, and the handle has to be:
	 * it is the thing the finger is holding. B(½) = (P₀ + 2C + P₂)/4, so the
	 * control that puts the curve under the finger is 2M − (P₀ + P₂)/2.
	 */
	function control(edge: Edge, bend: Point): Point {
		const [a, b] = ENDS[edge];
		return {
			x: 2 * bend.x - (quad[a].x + quad[b].x) / 2,
			y: 2 * bend.y - (quad[a].y + quad[b].y) / 2
		};
	}

	/** The boundary as an SVG path, straight where it is straight. */
	const shape = $derived.by(() => {
		const parts: string[] = [`M ${quad.tl.x} ${quad.tl.y}`];
		for (const edge of EDGES) {
			const [, b] = ENDS[edge];
			const bend = bends[edge];
			if (!bend) parts.push(`L ${quad[b].x} ${quad[b].y}`);
			else {
				const c = control(edge, bend);
				parts.push(`Q ${c.x} ${c.y} ${quad[b].x} ${quad[b].y}`);
			}
		}
		return `${parts.join(' ')} Z`;
	});

	/** Points along a bent edge, sampled from the curve the screen is drawing. */
	function curveOf(edge: Edge): Point[] {
		const bend = bends[edge];
		if (!bend) return [];
		const [a, b] = ENDS[edge];
		const c = control(edge, bend);
		const points: Point[] = [];
		for (let i = 1; i <= CURVE_POINTS; i++) {
			const t = i / (CURVE_POINTS + 1);
			const k = (1 - t) * (1 - t);
			points.push({
				x: k * quad[a].x + 2 * (1 - t) * t * c.x + t * t * quad[b].x,
				y: k * quad[a].y + 2 * (1 - t) * t * c.y + t * t * quad[b].y
			});
		}
		return points;
	}

	function apply() {
		// Ordered on the way out: dragging the top-left past the top-right is a
		// perfectly reasonable thing to do with a rotated photograph, and the warp
		// downstream requires tl/tr/br/bl to mean what they say.
		const ordered = orderCorners([quad.tl, quad.tr, quad.br, quad.bl]);
		const edges = {
			top: curveOf('top'),
			right: curveOf('right'),
			bottom: curveOf('bottom'),
			left: curveOf('left')
		};
		const bent = EDGES.some((edge) => edges[edge].length > 0);
		// A flat page hands back no edges at all, so nothing downstream has to
		// decide whether four empty arrays mean "straight" or "not measured".
		onapply(bent ? { corners: ordered, edges } : { corners: ordered });
	}
</script>

<div class="corners">
	<p class="hint">Drag the corners onto the page &middot; pull an edge to follow a curve</p>

	<div class="stage">
		<!-- A direct-manipulation surface, like the viewfinder: the pointer
		     handlers live here rather than on each handle so a drag that runs off
		     a dot still tracks. -->
		<div
			class="surface"
			role="application"
			aria-label="Page corners on the photograph"
			onpointermove={move}
			onpointerup={release}
			onpointercancel={release}
		>
			<img
				src={imageUrl}
				alt="The photograph, with the page corners marked"
				onerror={() => onunavailable?.()}
			/>
			<svg viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
				<!-- Everything outside the quad, dimmed. `evenodd` over the frame and
				     the quad is what makes the hole; a second shape would have to be
				     kept in step with the first. -->
				<!-- Everything outside the boundary, dimmed. `evenodd` over the frame
				     and the page is what makes the hole; a second shape would have to
				     be kept in step with the first. The page is a PATH rather than a
				     polygon now, because a bowed edge is a curve. -->
				<path class="veil" fill-rule="evenodd" d="M0,0 H{width} V{height} H0 Z {shape}" />
				<path class="edge" d={shape} stroke-width={stroke} fill="none" />
				{#each CORNERS as handle (handle)}
					<circle
						class="dot"
						class:active={selected === handle}
						cx={quad[handle].x}
						cy={quad[handle].y}
						r={dotRadius}
						stroke-width={stroke}
					/>
				{/each}
				<!-- Edge handles are drawn smaller and hollow: they are an
				     adjustment to a boundary that already exists, not one of the four
				     points that define it, and a page that needs none of them should
				     not look like it has eight things to place. -->
				{#each EDGES as edge (edge)}
					<circle
						class="bend"
						class:active={selected === edge}
						class:bent={bends[edge] !== null}
						cx={handleAt(edge).x}
						cy={handleAt(edge).y}
						r={dotRadius * 0.8}
						stroke-width={stroke}
					/>
				{/each}
			</svg>
			<!-- The grab targets sit ABOVE the drawing, and are invisible: a thumb
			     needs far more room than the dot it is placing. -->
			<svg
				class="targets"
				bind:this={overlay}
				viewBox="0 0 {width} {height}"
				preserveAspectRatio="xMidYMid meet"
			>
				{#each CORNERS as handle (handle)}
					<circle
						class="target"
						class:dragging={dragging === handle}
						cx={quad[handle].x}
						cy={quad[handle].y}
						r={grabRadius}
						role="button"
						tabindex="0"
						aria-label="{LABELS[handle]} corner"
						onpointerdown={(event) => grab(handle, event)}
						onkeydown={(event) => nudge(handle, event)}
						onfocus={() => (selected = handle)}
					/>
				{/each}
				{#each EDGES as edge (edge)}
					<circle
						class="target"
						class:dragging={dragging === edge}
						cx={handleAt(edge).x}
						cy={handleAt(edge).y}
						r={grabRadius * 0.8}
						role="button"
						tabindex="0"
						aria-label="{LABELS[edge]}, drag to follow a curved page"
						onpointerdown={(event) => grab(edge, event)}
						onkeydown={(event) => nudge(edge, event)}
						onfocus={() => (selected = edge)}
					/>
				{/each}
			</svg>
		</div>
	</div>

	<div class="deck">
		<p class="note">Arrow keys nudge the selected corner · Shift for bigger steps</p>
		<div class="actions">
			<button type="button" class="btn btn-primary" onclick={apply}>Use these edges</button>
			<button type="button" class="btn" onclick={oncancel}>Cancel</button>
			<button type="button" class="btn" onclick={() => (quad = fullFrameCorners(width, height))}
				>Whole photo</button
			>
		</div>
	</div>
</div>

<style>
	.corners {
		position: fixed;
		inset: 0;
		/* iOS Safari resolves `inset: 0` against the LARGE viewport, so the panel
		   ends up taller than the visible area and the page scrolls to make up the
		   difference. See ScanCapture for the same fix. */
		height: 100vh;
		height: 100dvh;
		z-index: 41;
		display: grid;
		grid-template-rows: auto 1fr auto;
		background: var(--bg);
		overflow: hidden;
		touch-action: none;
		overscroll-behavior: none;
	}
	.hint {
		margin: 0;
		padding: calc(var(--safe-top) + var(--space-5)) var(--space-6) var(--space-4);
		text-align: center;
		color: var(--fg2);
	}
	.stage {
		display: grid;
		place-items: center;
		min-height: 0;
		padding: 0 var(--space-5);
	}
	.surface {
		position: relative;
		/* Fills the stage and lets the PICTURE letterbox inside it. Sizing this
		   box to the photograph instead is what pushed a tall page off the side
		   of the screen — see `toFrame`. */
		width: 100%;
		height: 100%;
		display: block;
		touch-action: none;
	}
	.surface img {
		display: block;
		width: 100%;
		height: 100%;
		/* `contain` and the overlay's `xMidYMid meet` are defined to produce the
		   same rectangle, which is what keeps the handles on the picture. */
		object-fit: contain;
	}
	.surface svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.veil {
		fill: color-mix(in srgb, var(--bg) 68%, transparent);
	}
	.edge {
		fill: none;
		stroke: var(--detect-stable);
		vector-effect: non-scaling-stroke;
		stroke-width: 2;
	}
	.dot {
		fill: var(--bg);
		stroke: var(--detect-stable);
		vector-effect: non-scaling-stroke;
		stroke-width: 2;
	}
	.dot.active {
		fill: var(--detect-stable);
	}
	/* Hollow and unfilled until it is used: an edge handle is an adjustment to a
	   boundary that already exists, and a flat page should not look like it has
	   eight points waiting to be placed. */
	.bend {
		fill: none;
		stroke: var(--detect-stable);
		vector-effect: non-scaling-stroke;
		stroke-width: 2;
		opacity: 0.55;
	}
	.bend.bent,
	.bend.active {
		opacity: 1;
	}
	.bend.bent {
		fill: var(--bg);
	}
	.targets {
		cursor: grab;
	}
	.target {
		fill: transparent;
		touch-action: none;
	}
	.target.dragging {
		cursor: grabbing;
	}
	.target:focus-visible {
		outline: none;
		fill: color-mix(in srgb, var(--blue) 25%, transparent);
	}
	.deck {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-6) calc(var(--safe-bottom) + var(--space-6));
	}
	.note {
		margin: 0;
		text-align: center;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.actions {
		display: flex;
		gap: var(--space-4);
	}
	.actions .btn {
		flex: 1;
	}
	/* A thumb reaches the bottom band; on a short landscape phone the photograph
	   gets whatever is left rather than pushing the buttons off-screen. */
	@media (orientation: landscape) and (max-height: 620px) {
		.hint {
			padding-top: calc(var(--safe-top) + var(--space-3));
			padding-bottom: var(--space-2);
		}
		.deck {
			padding-top: var(--space-3);
		}
	}
</style>
