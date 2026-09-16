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
	 * `object-fit: cover` crops, so the picture's box is not the element's box,
	 * and `preserveAspectRatio` alone drifts from it once the stream and screen
	 * ratios diverge (e.g. a 4:3 stream on a portrait phone). Measured instead
	 * of inferred, so the overlay always sits on the actual picture.
	 */
	let picture = $state({ left: 0, top: 0, width: 0, height: 0 });

	function measurePicture() {
		if (!video?.videoWidth) return;
		const box = video.getBoundingClientRect();
		// `cover`: scale until both axes are filled, so the larger factor wins.
		const scale = Math.max(box.width / video.videoWidth, box.height / video.videoHeight);
		const width = video.videoWidth * scale;
		const height = video.videoHeight * scale;
		const next = { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
		// Skip the update when unchanged: this runs nine times a second.
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
			// The photograph goes up as bytes, undecoded — detection runs
			// server-side on the exact bytes uploaded, so there is nothing here
			// that can disagree with the viewfinder about orientation or size.
			oncapture(await stillFileFromTrack(camera.track, video));
		} finally {
			shooting = false;
		}
	}

	// Identity guard: this effect can rerun for reasons unrelated to the
	// camera, and reassigning the same stream would restart the element.
	// `play()` is called by hand because `autoplay` is unreliable for a stream
	// attached via `srcObject` — the element can sit at readyState 0 with
	// `videoWidth` still 0, which reads downstream as a dark, unstarted camera.

	// The video's own `resize` event fires on the STREAM's intrinsic size, not
	// the element's, so a phone rotation (stream stays 4:3) needs `resize` and
	// `orientationchange` both — iOS doesn't always fire the former on a turn.
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
			`srcObject` is deliberately NOT bound here: Svelte would group it into
			the same reactive effect as values rewritten nine times a second, and
			reassigning `srcObject` invokes the media element's load algorithm,
			resetting it to readyState 0 each time. It is attached once, imperatively, below.
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
			A static aiming guide only — detection runs server-side after the
			shutter, and a wrong crop is fixed with the corner handles rather than
			retaken.

			Placed from the measurement above so it sits on the PICTURE rather than
			the element — `object-fit: cover` means those are not the same
			rectangle on a portrait phone holding a 4:3 stream.
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
