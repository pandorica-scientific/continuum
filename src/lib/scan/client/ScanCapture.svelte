<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import Icon from '$lib/components/Icon.svelte';
	import { createCamera } from './camera.svelte.ts';
	import { stillFileFromTrack } from './frame.ts';
	import ScanPermission from './ScanPermission.svelte';

	let {
		oncapture,
		oncancel,
		onchoosefile,
		onreview,
		pageCount = 0,
		thumbnail = null
	}: {
		/** The photograph itself. Nothing in the browser opens it. */
		oncapture: (file: File) => void;
		oncancel: () => void;
		onchoosefile: () => void;
		/** Through to the document so far. */
		onreview?: () => void;
		pageCount?: number;
		/** The last page kept, shown in the deck's left slot. */
		thumbnail?: string | null;
	} = $props();

	const camera = createCamera();

	let video: HTMLVideoElement | undefined = $state();
	let torchOn = $state(false);
	let shooting = $state(false);

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

	async function shoot() {
		if (!video || !camera.track || shooting) return;
		shooting = true;
		try {
			// The photograph, as bytes, straight to the server. Nothing here
			// decodes it, measures it or looks for a page in it — which also
			// retires a whole class of bug: the crop used to be found on a frame
			// the browser had decoded and possibly re-oriented, so a still whose
			// aspect ratio disagreed with the viewfinder produced corners
			// describing a region of some other picture. Detection now runs on the
			// exact bytes that were uploaded, and there is nothing left to
			// disagree.
			oncapture(await stillFileFromTrack(camera.track, video));
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
		return () => camera.stop();
	});
</script>

{#if camera.state.kind === 'live'}
	<div class="capture" role="application" aria-label="Camera viewfinder">
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
			A STATIC FRAME GUIDE, where the tracked outline used to be.

			The outline was OpenCV running nine times a second in the browser, and
			taking it out is what lets the WebAssembly heap — the one an iPhone
			could not always allocate — leave the browser altogether. Auto-capture
			had already gone, so what is lost is an aiming aid rather than a
			trigger: everything the detector has to say now arrives after the
			shutter, from the server, where a crop that came out wrong is dragged
			into place with the corner handles rather than retaken.

			Still placed from the measurement above, so it sits on the PICTURE
			rather than on the element — `object-fit: cover` means those are not
			the same rectangle on a portrait phone holding a 4:3 stream.
		-->
		<div
			class="guide"
			aria-hidden="true"
			style="left: {picture.left}px; top: {picture.top}px; width: {picture.width}px; height: {picture.height}px"
		>
			<span class="frame"></span>
		</div>

		<div class="top">
			<button type="button" class="chip" onclick={oncancel}>Cancel</button>
		</div>

		<p class="guidance"><span class="chip">Fit the page inside the frame</span></p>

		<div class="deck">
			<span class="slot">
				{#if pageCount > 0}
					<!-- The way to the document so far. A thumbnail rather than a
					     labelled button: it shows what was last kept, which is the
					     reassurance someone scanning a stack actually wants. -->
					<button
						type="button"
						class="thumb"
						aria-label="Review {pageCount} {pageCount === 1 ? 'page' : 'pages'}"
						onclick={() => onreview?.()}
					>
						{#if thumbnail}<img src={thumbnail} alt="" />{/if}
						<span class="count">{pageCount}</span>
					</button>
				{/if}
			</span>
			<button
				type="button"
				class="shutter"
				aria-label="Take the photo"
				onclick={() => void shoot()}
			>
				<span class="disc"></span>
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
	.guide {
		position: absolute;
		pointer-events: none;
		display: grid;
		place-items: center;
	}
	/* Inset from the picture rather than filling it: a page held right to the
	   edges is a page whose edges the detector cannot see. */
	.frame {
		width: 82%;
		height: 78%;
		border: var(--detect-w-found) dashed var(--detect-searching);
		border-radius: var(--radius-md);
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
	.thumb {
		position: relative;
		width: 46px;
		height: 60px;
		padding: 0;
		border: 1px solid var(--scan-plate-edge);
		border-radius: var(--radius-sm);
		background: var(--scan-plate);
		overflow: hidden;
		cursor: pointer;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.count {
		position: absolute;
		right: -4px;
		bottom: -4px;
		min-width: 20px;
		padding: 1px 5px;
		border-radius: var(--radius-pill);
		background: var(--detect-stable);
		color: var(--fg-inverse);
		font-size: var(--text-2xs);
		font-weight: 600;
	}
	.thumb:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
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
	.chip:focus-visible,
	.shutter:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
</style>
