<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Four handles on the photograph, for when the detector was wrong.
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

	import { fullFrameCorners, orderCorners, type Corners, type Point } from '../core/index.ts';

	let {
		imageUrl,
		width,
		height,
		corners = null,
		onapply,
		oncancel
	}: {
		/** The photograph, UNCROPPED — the whole frame the corners are measured in. */
		imageUrl: string;
		/** The frame's dimensions, and so the coordinate space of `corners`. */
		width: number;
		height: number;
		/** Where the detector put them, or null when it found nothing. */
		corners?: Corners | null;
		onapply: (corners: Corners) => void;
		oncancel: () => void;
	} = $props();

	type Handle = keyof Corners;
	const HANDLES: Handle[] = ['tl', 'tr', 'br', 'bl'];
	const LABELS: Record<Handle, string> = {
		tl: 'Top left',
		tr: 'Top right',
		br: 'Bottom right',
		bl: 'Bottom left'
	};

	/**
	 * A quad to start from when the detector found nothing.
	 *
	 * Deliberately NOT the full frame. Handles sitting exactly on the edges are
	 * half off-screen and read as "nothing to drag"; inset, the shape says at a
	 * glance that it is a box you are meant to move.
	 */
	function startingQuad(): Corners {
		if (corners) return corners;
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

	// The detector's answer is the STARTING point, read once. Later changes to
	// `corners` are this component's own doing, echoed back by the parent, and
	// following them would fight the hand that is dragging.
	let quad = $state<Corners>(startingQuad());
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

	function move(event: PointerEvent) {
		if (!dragging) return;
		const at = toFrame(event);
		if (at) quad = { ...quad, [dragging]: at };
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
		const from = quad[handle];
		quad = {
			...quad,
			[handle]: { x: clamp(from.x + delta.x, width), y: clamp(from.y + delta.y, height) }
		};
	}

	const outline = $derived(HANDLES.map((h) => `${quad[h].x},${quad[h].y}`).join(' '));

	function apply() {
		// Ordered on the way out: dragging the top-left past the top-right is a
		// perfectly reasonable thing to do with a rotated photograph, and the warp
		// downstream requires tl/tr/br/bl to mean what they say.
		onapply(orderCorners([quad.tl, quad.tr, quad.br, quad.bl]));
	}
</script>

<div class="corners">
	<p class="hint">Drag the four corners onto the page</p>

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
			<img src={imageUrl} alt="The photograph, with the page corners marked" />
			<svg viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
				<!-- Everything outside the quad, dimmed. `evenodd` over the frame and
				     the quad is what makes the hole; a second shape would have to be
				     kept in step with the first. -->
				<path
					class="veil"
					fill-rule="evenodd"
					d="M0,0 H{width} V{height} H0 Z M{outline.split(' ').join(' L')} Z"
				/>
				<polygon class="edge" points={outline} stroke-width={stroke} />
				{#each HANDLES as handle (handle)}
					<circle
						class="dot"
						class:active={selected === handle}
						cx={quad[handle].x}
						cy={quad[handle].y}
						r={dotRadius}
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
				{#each HANDLES as handle (handle)}
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
