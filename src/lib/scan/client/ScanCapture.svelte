<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import Icon from '$lib/components/Icon.svelte';
	import {
		DETECT_WIDTH,
		detectOnce,
		hairline,
		scaleCorners,
		type Corners,
		type DetectState,
		type Frame
	} from '../core/index.ts';
	import { loadCv } from './opencv-load.ts';
	import { createCamera } from './camera.svelte.ts';
	import { frameFromBitmapSource, frameFromVideo, stillFromTrack } from './frame.ts';
	import {
		DETECT_INTERVAL_MS,
		GUIDANCE_DEBOUNCE_MS,
		HOLD_MS,
		createStability,
		guidanceFor
	} from './loop.svelte.ts';
	import ScanPermission from './ScanPermission.svelte';

	let {
		oncapture,
		oncancel,
		onchoosefile,
		pageCount = 0
	}: {
		oncapture: (frame: Frame, corners: Corners | null) => void;
		oncancel: () => void;
		onchoosefile: () => void;
		pageCount?: number;
	} = $props();

	/** Where the capture-time detection pass runs: twice the live width, so a
	 *  refined corner is worth having. */
	const REFINE_WIDTH = 1280;

	const camera = createCamera();
	const stability = createStability(DETECT_WIDTH);

	let video: HTMLVideoElement | undefined = $state();
	let detect = $state<DetectState>({ kind: 'searching' });
	let guidance = $state('Point at the page');
	let holding = $state(false);
	let torchOn = $state(false);
	let shooting = $state(false);
	// The detection frame's own dimensions. The overlay's viewBox is exactly
	// this, so a corner found at (x, y) in the frame is drawn at (x, y) — no
	// scaling factor to get wrong.
	let frameWidth = $state(DETECT_WIDTH);
	let frameHeight = $state(Math.round(DETECT_WIDTH * 0.75));

	/**
	 * Where the video's picture actually lands inside its element.
	 *
	 * `object-fit: cover` fills the screen and crops — which is what a camera is
	 * expected to look like — but it means the picture's box is NOT the
	 * element's box. Relying on the SVG's own `preserveAspectRatio` to arrive at
	 * the same rectangle only works while the stream's aspect ratio and the
	 * screen's are close; on a portrait phone holding a 4:3 stream they are not,
	 * and the outline drifts away from the page it is meant to be tracing.
	 *
	 * So the overlay is positioned from this measurement instead of being
	 * inferred. Whatever the browser does with the video, the outline sits on it.
	 */
	let picture = $state({ left: 0, top: 0, width: 0, height: 0 });

	function measurePicture() {
		if (!video?.videoWidth) return;
		const box = video.getBoundingClientRect();
		// `cover`: scale until BOTH axes are filled, so the larger factor wins.
		const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
		const width = video.videoWidth * scale;
		const height = video.videoHeight * scale;
		const next = { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
		// A new object every tick would invalidate everything reading it, nine
		// times a second, for a rectangle that almost never changes.
		if (
			next.left === picture.left &&
			next.top === picture.top &&
			next.width === picture.width &&
			next.height === picture.height
		) {
			return;
		}
		picture = next;
	}

	let guidanceTimer: ReturnType<typeof setTimeout> | undefined;
	let holdTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * No entry for `searching`, deliberately: no page found means no outline,
	 * because a speculative box is a claim the detector has not made. Every read
	 * below tolerates the absence — assuming an entry exists is what took the
	 * prototype's permission screens down.
	 */
	const OUTLINE = {
		detected: {
			width: 'var(--detect-w-found)',
			colour: 'var(--detect-found)',
			dash: 'none',
			brackets: true
		},
		stable: {
			width: 'var(--detect-w-stable)',
			colour: 'var(--detect-stable)',
			dash: 'none',
			brackets: true
		},
		rejected: {
			width: 'var(--detect-w-found)',
			colour: 'var(--detect-rejected)',
			dash: 'var(--detect-dash-rejected)',
			brackets: false
		}
	} as const;

	const outline = $derived(OUTLINE[detect.kind as keyof typeof OUTLINE]);
	const corners = $derived('corners' in detect ? detect.corners : null);
	// Brackets are drawn from the segment they sit on, so anything computed goes
	// through `hairline` rather than straight into a stroke.
	const bracket = $derived(hairline(detect.kind === 'stable' ? 3 : 2));

	const points = (c: Corners) => [c.tl, c.tr, c.br, c.bl].map((p) => `${p.x},${p.y}`).join(' ');

	/** Debounced, or the user gets a strobing instruction they cannot read. */
	function say(line: string) {
		if (line === guidance) return;
		clearTimeout(guidanceTimer);
		guidanceTimer = setTimeout(() => (guidance = line), GUIDANCE_DEBOUNCE_MS);
	}

	function cancelHold() {
		if (!holding) return;
		holding = false;
		clearTimeout(holdTimer);
		stability.reset();
	}

	async function shoot() {
		if (!video || !camera.track || shooting) return;
		shooting = true;
		cancelHold();
		try {
			// Sensor resolution for the page itself — not the 640px detection
			// frame, and not the video track's 1080p either.
			const full = await stillFromTrack(camera.track, video);

			// Detect again, on the STILL, at twice the live resolution and with
			// edge refinement on.
			//
			// Two things are wrong with reusing the live corners. They describe a
			// frame captured a moment earlier, so any movement between the last
			// tick and the shutter is baked into the crop; and they come from a
			// 640px pass whose corners are a polygon approximation of a blurred
			// mask. This pass costs a few hundred milliseconds, paid once, while
			// the preview is being prepared anyway.
			const cv = await loadCv();
			const measured = frameFromBitmapSource(full, REFINE_WIDTH);
			const settled = detectOnce(cv, measured, { gates: false, refine: true });
			const found = 'corners' in settled ? settled.corners : null;

			const scaled = found
				? scaleCorners(found, full.width / measured.width)
				: // Fall back to the live corners rather than to nothing: a slightly
					// stale crop beats no crop, and `renderPage` treats null as the
					// full frame.
					corners
					? scaleCorners(corners, full.width / DETECT_WIDTH)
					: null;
			oncapture(full, scaled);
		} finally {
			shooting = false;
		}
	}

	/**
	 * Attach the stream once and start it.
	 *
	 * The identity guard is the point: this effect may run again for reasons
	 * that have nothing to do with the camera, and assigning the same stream a
	 * second time would restart the element rather than being a no-op.
	 *
	 * `play()` is called by hand because `autoplay` is not reliable for a stream
	 * attached through `srcObject` — the element can sit at readyState 0, paused,
	 * with `videoWidth` still 0. The symptom is not "no video": the pipeline
	 * draws that element to a canvas, reads pure black, and reports "Too dark —
	 * try more light" about a camera that never started.
	 */
	/**
	 * Re-measure when the window changes shape.
	 *
	 * The video's own `resize` event fires when the STREAM's intrinsic size
	 * changes, not when its element does — so rotating the phone changes the box
	 * the picture is drawn into while the stream stays 4:3, the measurement goes
	 * stale, and the outline drifts off the page it is tracing. `orientationchange`
	 * as well as `resize`, because iOS does not always fire the latter on a turn.
	 */
	$effect(() => {
		const remeasure = () => measurePicture();
		window.addEventListener('resize', remeasure);
		window.addEventListener('orientationchange', remeasure);
		return () => {
			window.removeEventListener('resize', remeasure);
			window.removeEventListener('orientationchange', remeasure);
		};
	});

	$effect(() => {
		if (camera.state.kind !== 'live' || !video) return;
		const stream = camera.state.stream;
		if (video.srcObject === stream) return;
		video.srcObject = stream;
		void video
			.play()
			.then(measurePicture)
			.catch(() => {});
	});

	$effect(() => {
		void camera.start();
		let running = true;
		let last = 0;

		void (async () => {
			const cv = await loadCv();
			const tick = (now: number) => {
				if (!running) return;
				requestAnimationFrame(tick);
				// A timestamp gate rather than setInterval: setInterval queues work
				// the main thread cannot drain, and that queue never recovers.
				if (now - last < DETECT_INTERVAL_MS) return;
				last = now;
				if (camera.state.kind !== 'live' || !video?.videoWidth || shooting) return;

				const frame = frameFromVideo(video);
				frameWidth = frame.width;
				frameHeight = frame.height;
				measurePicture();
				const next = detectOnce(cv, frame);
				const settled = stability.settled(next);
				detect =
					settled && next.kind === 'detected' ? { kind: 'stable', corners: next.corners } : next;
				say(guidanceFor(detect));

				if (settled && !holding) {
					holding = true;
					holdTimer = setTimeout(() => void shoot(), HOLD_MS);
				} else if (!settled) {
					cancelHold();
				}
			};
			requestAnimationFrame(tick);
		})();

		return () => {
			running = false;
			cancelHold();
			clearTimeout(guidanceTimer);
			camera.stop();
		};
	});
</script>

{#if camera.state.kind === 'live'}
	<!-- Any touch ANYWHERE cancels a pending capture, not just a touch on a
	     control. Capture phase, so a control's own handler cannot swallow it. -->
	<div
		class="capture"
		role="application"
		aria-label="Camera viewfinder"
		onpointerdowncapture={cancelHold}
	>
		<!--
			`srcObject` is deliberately NOT bound here. Svelte groups template
			bindings into one reactive effect, and this element sits beside values
			the detection loop rewrites nine times a second — so the compiler put
			the stream assignment in that same effect. Reassigning `srcObject`
			invokes the media element's load algorithm, which resets it to
			readyState 0 and pauses it: the camera was being torn down and
			restarted nine times a second, rendering nothing but black while
			reporting "too dark". It is attached once, imperatively, below.
		-->
		<video
			bind:this={video}
			autoplay
			playsinline
			muted
			onloadedmetadata={measurePicture}
			onresize={measurePicture}
		></video>

		<!--
			Sized and placed from the measurement above, so its coordinate space
			is exactly the picture the user can see. Because the box already
			matches, `none` is correct here — there is no remaining aspect
			difference for the SVG to reconcile.
		-->
		<svg
			class="overlay"
			style="left: {picture.left}px; top: {picture.top}px; width: {picture.width}px; height: {picture.height}px"
			viewBox="0 0 {frameWidth} {frameHeight}"
			preserveAspectRatio="none"
		>
			{#if corners && outline}
				<polygon
					points={points(corners)}
					fill="none"
					stroke={outline.colour}
					stroke-width={outline.width}
					stroke-dasharray={outline.dash}
					vector-effect="non-scaling-stroke"
				/>
				{#if outline.brackets && bracket.stroked}
					<!-- Brackets only when four corners are actually found, which
					     makes searching → detected two shape changes rather than
					     one, and keeps the states separable without colour. -->
					{#each [corners.tl, corners.tr, corners.br, corners.bl] as corner, i (i)}
						<circle
							cx={corner.x}
							cy={corner.y}
							r="6"
							fill="none"
							stroke={outline.colour}
							stroke-width={bracket.width}
							vector-effect="non-scaling-stroke"
						/>
					{/each}
				{/if}
			{:else}
				<!-- A slow sweep says the camera is working without asserting a
				     result. A @keyframes animation, so reduced motion stops it. -->
				<rect class="sweep" x="0" y="0" width={DETECT_WIDTH} height="2.5" />
			{/if}
		</svg>

		<div class="top">
			<button type="button" class="chip" onclick={oncancel}>Cancel</button>
			{#if pageCount > 0}
				<span class="chip">{pageCount} {pageCount === 1 ? 'page' : 'pages'}</span>
			{/if}
		</div>

		<p class="guidance"><span class="chip">{guidance}</span></p>

		<div class="deck">
			<span class="slot"></span>
			<button
				type="button"
				class="shutter"
				class:holding
				aria-label={holding ? 'Capturing now — tap to cancel' : 'Take the photo'}
				onclick={() => (holding ? cancelHold() : void shoot())}
			>
				<span class="disc"></span>
				<svg class="ring" viewBox="0 0 72 72" aria-hidden="true">
					<circle cx="36" cy="36" r="33" />
				</svg>
			</button>
			<span class="slot end">
				{#if camera.state.torch}
					<button
						type="button"
						class="chip torch"
						aria-pressed={torchOn}
						aria-label="Flash"
						onclick={() => {
							torchOn = !torchOn;
							void camera.setTorch(torchOn);
						}}
					>
						<Icon name="bolt" size={19} />
					</button>
				{/if}
			</span>
		</div>
	</div>
{:else if camera.state.kind !== 'idle'}
	<ScanPermission state={camera.state.kind} onallow={() => void camera.start()} {onchoosefile} />
{/if}

<style>
	.capture {
		position: fixed;
		inset: 0;
		/* Not `inset: 0` alone.
		 *
		 * On iOS Safari a fixed element sized that way resolves against the LARGE
		 * viewport — the full height including the strip behind the collapsing
		 * browser chrome — so the panel ends up taller than the part you can see
		 * and the page scrolls to make up the difference. `100dvh` follows the
		 * visible area as the chrome expands and contracts; `100vh` is the
		 * fallback for anything that predates it, and is what `inset: 0` would
		 * have given anyway. */
		height: 100vh;
		height: 100dvh;
		z-index: 40;
		background: #000;
		overflow: hidden;
		/* A drag on a scan screen is not a scroll. Without this the browser
		   still tries to pan, which on iOS shows as the whole panel rubber-banding
		   away from the top of the screen. */
		touch-action: none;
		overscroll-behavior: none;
		overflow: hidden;
	}
	video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		/* Full-bleed, the way a camera is expected to look. The overlay is
		   measured against the result rather than assuming it. */
		object-fit: cover;
	}
	.overlay {
		position: absolute;
		/* left/top/width/height come from measurePicture(). */
	}
	.sweep {
		fill: var(--detect-searching);
		animation: sweep 2.6s var(--ease-out) infinite;
	}
	@keyframes sweep {
		from {
			transform: translateY(0);
		}
		to {
			transform: translateY(360px);
		}
	}
	.top {
		position: absolute;
		top: calc(var(--safe-top) + var(--space-6));
		left: calc(var(--safe-left) + var(--space-6));
		right: calc(var(--safe-right) + var(--space-6));
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--touch-min);
		padding: 0 var(--space-6);
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--scan-plate);
		color: var(--scan-ink);
		font: inherit;
		cursor: pointer;
	}
	.guidance {
		position: absolute;
		left: var(--space-6);
		right: var(--space-6);
		bottom: calc(var(--safe-bottom) + 132px);
		margin: 0;
		/* Fixed height, so a longer line never moves the deck below it. */
		min-height: var(--touch-min);
		display: flex;
		justify-content: center;
	}
	/* Nothing the user must reach mid-capture sits above the bottom third; the
	   way to honour that is positioning the deck from the bottom edge. */
	.deck {
		position: absolute;
		left: calc(var(--safe-left) + var(--space-8));
		right: calc(var(--safe-right) + var(--space-8));
		bottom: calc(var(--safe-bottom) + var(--space-8));
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
	}
	.slot {
		display: flex;
	}
	.slot.end {
		justify-content: flex-end;
	}
	/* Landscape on a PHONE. The guidance chip is placed clear of the deck by a
	   distance that assumes a tall screen; on a 390px one that pushes it into
	   the middle of the page being framed. The deck itself already sits on the
	   bottom edge and needs no change — a thumb reaches it either way round. */
	@media (orientation: landscape) and (max-height: 620px) {
		.guidance {
			bottom: calc(var(--safe-bottom) + 96px);
		}
	}
	.shutter {
		position: relative;
		width: var(--shutter-size);
		height: var(--shutter-size);
		border: 0;
		border-radius: var(--radius-pill);
		background: transparent;
		cursor: pointer;
	}
	.disc {
		display: block;
		width: calc(var(--shutter-size) - 16px);
		height: calc(var(--shutter-size) - 16px);
		margin: 8px;
		border-radius: var(--radius-pill);
		background: var(--scan-ink);
	}
	.ring {
		position: absolute;
		inset: 0;
	}
	.ring circle {
		fill: none;
		stroke: var(--detect-stable);
		stroke-width: 3;
		stroke-dasharray: 208;
		stroke-dashoffset: 208;
	}
	/* A TRANSITION, not an animation — which is exactly why the reduced-motion
	   block in app.css has to cover transitions as well. */
	.shutter.holding .ring circle {
		stroke-dashoffset: 0;
		transition: stroke-dashoffset var(--motion-hold) linear;
	}
	.chip:focus-visible,
	.shutter:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
</style>
