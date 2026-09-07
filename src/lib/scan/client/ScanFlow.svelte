<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The one component a call site mounts. It owns which screen is showing.
	//
	// The render happens immediately after capture, while the user is looking at
	// the preview — not batched at the end. It costs about a second a page, and
	// paid there it is invisible.

	import {
		applyOrientation,
		assemblePdf,
		detectBest,
		REFINE_WIDTH,
		renderPage,
		scaleCorners,
		turnCorners,
		type Corners,
		type Frame,
		type PageMode,
		type PageSource
	} from '../core/index.ts';
	import { loadCv } from './opencv-load.ts';
	import { isSecureForCamera } from './camera.svelte.ts';
	import {
		encodeJpeg,
		frameFromBitmap,
		frameFromBitmapSource,
		frameFromFile,
		frameToBlob
	} from './frame.ts';
	import ScanCapture from './ScanCapture.svelte';
	import ScanCorners from './ScanCorners.svelte';
	import ScanPagePreview from './ScanPagePreview.svelte';
	import ScanReview from './ScanReview.svelte';
	import { createSession } from './session.svelte.ts';

	let {
		incoming = [],
		onclose,
		onchoosefile,
		ondone
	}: {
		/** Photographs dropped on the call site, to run through the pipeline
		 *  instead of opening the viewfinder. */
		incoming?: File[];
		onclose: () => void;
		/** The upload path's Replace: there is no viewfinder to go back to. */
		onchoosefile?: () => void;
		/** The finished page, handed to whatever the call site already does with a file. */
		ondone: (file: File) => void | Promise<void>;
	} = $props();

	// The INITIAL value is exactly what is wanted here, and reading it once is
	// deliberate: were this to start on 'capture', the viewfinder would mount for
	// a frame and ask for camera permission — for a photograph already in hand.
	// svelte-ignore state_referenced_locally
	let screen = $state<'capture' | 'preview' | 'review' | 'reading' | 'corners'>(
		incoming.length ? 'reading' : 'capture'
	);
	const session = createSession();
	let busy = $state(false);
	let failure = $state<string | null>(null);
	/**
	 * What the reading screen is doing right now.
	 *
	 * It began as a diagnostic — a phone on plain http has no console anyone can
	 * reach, and naming the step is what located a hang that had no error to
	 * report. It stays because the honest answer to "why is this taking a
	 * moment" is worth showing; the sizes and timings it also printed have gone,
	 * having been for whoever was debugging it rather than for whoever is
	 * scanning.
	 */
	let stage = $state('');

	/**
	 * Preview at a fraction of the resolution.
	 *
	 * Switching mode re-runs the whole pipeline, and doing that at capture
	 * resolution means warping and filtering 13 megapixels to fill a box about
	 * 800px wide. It is wasted work and it is felt: a dropped 48MP photograph
	 * caps at 3200px and takes roughly five times as long as a phone capture,
	 * which is why the same switch felt quick on a phone and slow on a Mac.
	 *
	 * The full-resolution frame is kept and rendered ONCE, when the page is
	 * actually kept, so nothing is lost from the output.
	 */
	const PREVIEW_WIDTH = 1400;

	/**
	 * Quality for the page that is KEPT, and for that same page again inside
	 * the PDF.
	 *
	 * Higher than the encoder's 0.85 default because this frame is encoded
	 * TWICE — once here, and again when `assemblePdf` decodes it and writes it
	 * into the document — and the losses compound. At 0.85 twice over a phone
	 * photograph of a laminated card came back visibly blocked. The preview is
	 * left at the default: it is looked at once and thrown away, and encoding
	 * is the slowest step on a phone.
	 */
	const KEEP_QUALITY = 0.95;

	/** The full-resolution capture, kept only while the preview is open. */
	let source = $state<{ frame: Frame; corners: Corners | null; from: PageSource } | null>(null);
	/** Remembered past `discard()`, which clears the source it came from. */
	let fromUpload = $state(false);

	/**
	 * Where the next page comes from. The in-page viewfinder needs a secure
	 * context, which a self-hosted Continuum on a plain-http address never
	 * has; there, every page comes from the phone's own camera app instead,
	 * through the input below, and lands on the same pipeline. The review
	 * screen is what you come back to between pages either way.
	 */
	const viewfinder = typeof window !== 'undefined' && isSecureForCamera(window.location);
	let cameraInput = $state<HTMLInputElement | null>(null);
	function nextPage() {
		if (viewfinder) screen = 'capture';
		else cameraInput?.click();
	}
	/** The same, scaled down, for everything the preview needs. */
	let draft = $state<{ frame: Frame; corners: Corners | null } | null>(null);
	let mode = $state<PageMode>('bw');
	let previewUrl = $state('');

	function releasePreview() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = '';
	}

	/**
	 * The capture at preview resolution, with its corners carried across. Built
	 * once per capture and reused: the corner editor and every mode switch work
	 * from the same frame, so none of them pays for the downscale again.
	 */
	function ensureDraft(): { frame: Frame; corners: Corners | null } | null {
		if (draft) return draft;
		if (!source) return null;
		const small = frameFromBitmapSource(source.frame, PREVIEW_WIDTH);
		draft = {
			frame: small,
			corners: source.corners
				? scaleCorners(source.corners, small.width / source.frame.width)
				: null
		};
		return draft;
	}

	/** The uncropped photograph, held only while the corner editor is open. */
	let cornersUrl = $state('');

	function releaseCorners() {
		if (cornersUrl) URL.revokeObjectURL(cornersUrl);
		cornersUrl = '';
	}

	/**
	 * Show the photograph with handles on it.
	 *
	 * The draft frame, not the full capture: the editor only has to be accurate
	 * to the pixel the user can see, and encoding a 12 MP frame to look at on a
	 * phone screen is the slowest thing this component could do.
	 */
	async function openCorners() {
		if (!source) return;
		busy = true;
		failure = null;
		try {
			const held = ensureDraft();
			if (!held) return;
			releaseCorners();
			cornersUrl = URL.createObjectURL(await frameToBlob(held.frame, 'image/jpeg'));
			screen = 'corners';
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That photo could not be opened.';
		} finally {
			busy = false;
		}
	}

	/**
	 * Take the edges the user drew and re-render from them.
	 *
	 * They arrive in the DRAFT's coordinates and the warp reads the full capture,
	 * so they are scaled back on the way in — the same carry the detector's own
	 * corners make, in the opposite direction. `draft` is dropped because the one
	 * it holds describes the old crop.
	 */
	function applyCorners(next: Corners) {
		if (!source || !draft) return;
		source = { ...source, corners: scaleCorners(next, source.frame.width / draft.frame.width) };
		draft = null;
		releaseCorners();
		void show(mode);
	}

	/** Render the held capture in the chosen mode and show it. */
	async function show(next: PageMode) {
		if (!source) return;
		busy = true;
		failure = null;
		try {
			const cv = await loadCv();
			// Built once per capture, then reused for every mode switch.
			const held = ensureDraft();
			if (!held) return;
			// A failed detection degrades to the full frame inside renderPage —
			// never to an error, because there is nothing else the user could do
			// about it. `original` skips the warp entirely, which is what makes it
			// the recovery when the edges came out wrong.
			const page = renderPage(cv, held.frame, held.corners, next);
			releasePreview();
			// PNG for a binarized page: lossless, and JPEG ringing around black
			// text on white is the one artefact that costs legibility.
			previewUrl = URL.createObjectURL(
				await frameToBlob(page, next === 'bw' ? 'image/png' : 'image/jpeg')
			);
			mode = next;
			screen = 'preview';
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That page could not be processed.';
		} finally {
			busy = false;
		}
	}

	/**
	 * Render the chosen mode at full resolution, encode it, and add it to the
	 * document. Only the encoded page is kept — see session.svelte.ts.
	 */
	async function keep() {
		if (!source) return;
		busy = true;
		try {
			// The one full-resolution render, of the mode actually chosen. Every
			// other pass has been on the draft.
			const cv = await loadCv();
			const page = renderPage(cv, source.frame, source.corners, mode);
			// PNG for a binarized page: lossless, and JPEG ringing around black
			// text on white is the one artefact that costs legibility.
			const blob = await frameToBlob(
				page,
				mode === 'bw' ? 'image/png' : 'image/jpeg',
				KEEP_QUALITY
			);
			session.add(mode, blob);
			discard();
			// A dropped photo has no viewfinder to go back to, and a full document
			// has nowhere further to go: both land on the review screen, as does
			// every page on plain http. Otherwise return to the camera, which is
			// what someone scanning a stack wants.
			screen = fromUpload || session.full || !viewfinder ? 'review' : 'capture';
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That page could not be kept.';
		} finally {
			busy = false;
		}
	}

	/** Write every kept page into one PDF, in the order shown. */
	async function make() {
		if (session.pages.length === 0) return;
		busy = true;
		failure = null;
		try {
			const name = session.filename;
			const bytes = await assemblePdf(
				// Providers, not pages: each is decoded, written and dropped before
				// the next is touched, so twenty pages cost one page of memory.
				session.pages.map((page) => async () => {
					const bitmap = await createImageBitmap(page.blob);
					try {
						return { frame: frameFromBitmap(bitmap), mode: page.mode };
					} finally {
						bitmap.close();
					}
				}),
				{ title: name, encodeJpeg: (frame) => encodeJpeg(frame, KEEP_QUALITY) }
			);
			await ondone(new File([bytes], `${name}.pdf`, { type: 'application/pdf' }));
			session.dispose();
			onclose();
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That PDF could not be built.';
		} finally {
			busy = false;
		}
	}

	/** Back to the viewfinder. Nothing is lost by trying again — that is what
	 *  makes shipping without corner handles defensible. */
	function replace() {
		discard();
		screen = 'capture';
	}

	function discard() {
		releasePreview();
		releaseCorners();
		source = null;
		draft = null;
		mode = 'bw';
	}

	/**
	 * Hold the page still underneath.
	 *
	 * `overflow: hidden` on the body is the obvious lock and it does not work on
	 * iOS Safari — touch scrolling ignores it. The technique that does work is to
	 * pin the body with `position: fixed` at its current offset, which takes it
	 * out of flow entirely so there is nothing left to scroll, then put the
	 * offset back on the way out. Without it a drag beginning on the viewfinder
	 * scrolls the document behind, and the camera appears to slide under your
	 * thumb.
	 */
	$effect(() => {
		const body = document.body;
		const offset = window.scrollY;
		const previous = {
			position: body.style.position,
			top: body.style.top,
			left: body.style.left,
			right: body.style.right,
			overflow: body.style.overflow
		};

		body.style.position = 'fixed';
		body.style.top = `-${offset}px`;
		body.style.left = '0';
		body.style.right = '0';
		body.style.overflow = 'hidden';

		return () => {
			body.style.position = previous.position;
			body.style.top = previous.top;
			body.style.left = previous.left;
			body.style.right = previous.right;
			body.style.overflow = previous.overflow;
			// Pinning the body scrolled it to the top; put the reader back where
			// they were rather than at the top of the documents list.
			window.scrollTo(0, offset);
		};
	});

	/**
	 * Take a dropped photograph through the pipeline.
	 *
	 * Detection runs with the quality gates OFF. There is no retake here — the
	 * file is whatever the gallery held — so rejecting it for being blurry or
	 * dimly lit helps nobody; the user would simply be told no. Whatever can be
	 * found is found, and if nothing is, `renderPage` falls back to the full
	 * frame and `original` is one tap away.
	 */
	async function readDropped(file: File) {
		screen = 'reading';
		failure = null;
		try {
			// Decoding a 48 MP HEIC took 3.6 seconds when measured, which is why
			// this screen exists at all rather than a silent pause.
			stage = 'Decoding the photograph…';
			const frame = await frameFromFile(file);
			stage = 'Starting the scanner…';
			const cv = await loadCv();
			stage = 'Finding the page…';
			// Measured at a KNOWN width, then the corners scaled back onto the
			// frame that actually gets warped — the same two steps the
			// viewfinder's shutter takes. Handing `detectBest` the full frame
			// instead runs every absolute-pixel kernel inside it against three
			// times the width they are sized for: six times the work, and a
			// page mask too broken to yield a quad, so the photograph came back
			// slowly AND uncropped.
			const measured = frameFromBitmapSource(frame, REFINE_WIDTH);
			const settled = detectBest(cv, measured);
			const found = 'corners' in settled ? settled.corners : null;
			source = {
				frame,
				corners: found ? scaleCorners(found, frame.width / measured.width) : null,
				from: 'upload'
			};
			fromUpload = true;
			stage = 'Preparing the page…';
			await show('bw');
			// `show()` reports its own failures through `failure` and leaves the
			// screen where it was — which here is this one. Without this line a
			// render that fails (OpenCV out of memory, `toBlob` handing back
			// nothing under iOS memory pressure) leaves "Reading photo…" up for
			// good, with the error pill underneath as the only sign anything ended.
			if (screen === 'reading') screen = viewfinder ? 'capture' : 'review';
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That photo could not be read.';
			screen = viewfinder ? 'capture' : 'review';
		} finally {
			stage = '';
		}
	}

	$effect(() => {
		const [file] = incoming;
		if (file) void readDropped(file);
	});
</script>

<!-- The phone's camera app, for a page on plain http. `capture` opens the
     camera directly rather than the gallery; the photo is read like a dropped
     one. -->
<input
	bind:this={cameraInput}
	type="file"
	accept="image/*"
	capture="environment"
	tabindex="-1"
	aria-hidden="true"
	hidden
	onchange={() => {
		const file = cameraInput?.files?.[0];
		if (cameraInput) cameraInput.value = '';
		if (file) void readDropped(file);
	}}
/>

{#if screen === 'reading'}
	<div class="reading">
		<p>Reading photo…</p>
		{#if stage}<p class="stage">{stage}</p>{/if}
	</div>
{:else if screen === 'review'}
	<ScanReview
		pages={session.pages}
		filename={session.filename}
		{busy}
		onmove={session.move}
		onremove={session.remove}
		onrename={session.rename}
		onadd={nextPage}
		onmake={() => void make()}
		oncancel={() => {
			session.dispose();
			discard();
			onclose();
		}}
	/>
{:else if screen === 'capture'}
	<ScanCapture
		pageCount={session.pages.length}
		thumbnail={session.pages.at(-1)?.previewUrl ?? null}
		oncapture={(frame, corners) => {
			source = { frame, corners, from: 'camera' };
			void show('bw');
		}}
		onreview={() => (screen = 'review')}
		oncancel={() => {
			// Pages already kept are not thrown away silently: if there are any,
			// Cancel goes to the review screen where discarding is a deliberate act.
			if (session.pages.length > 0) {
				discard();
				screen = 'review';
				return;
			}
			discard();
			onclose();
		}}
		onchoosefile={() => {
			session.dispose();
			discard();
			onclose();
		}}
	/>
{:else if screen === 'corners' && source && draft}
	<ScanCorners
		imageUrl={cornersUrl}
		width={draft.frame.width}
		height={draft.frame.height}
		corners={draft.corners}
		onapply={applyCorners}
		oncancel={() => {
			releaseCorners();
			screen = 'preview';
		}}
	/>
{:else if source}
	<ScanPagePreview
		{previewUrl}
		{mode}
		{busy}
		source={source.from}
		onkeep={() => void keep()}
		onreplace={() => {
			// On the upload path there is no viewfinder to return to, so Replace
			// means "pick a different file" and the button says so.
			if (source?.from === 'upload') {
				// But the pages already kept are not this photograph's to throw
				// away. Handing back to the call site UNMOUNTS this component and
				// the session goes with it, so retaking a page you did not like
				// silently cost you every page behind it. Retake in place instead
				// and leave the document alone.
				if (session.pages.length > 0) {
					discard();
					// Somewhere to land if the camera is dismissed: the review
					// screen, still holding the pages that never went anywhere.
					screen = 'review';
					nextPage();
					return;
				}
				discard();
				(onchoosefile ?? onclose)();
				return;
			}
			replace();
		}}
		onmode={(next) => void show(next)}
		onedges={() => void openCorners()}
		onrotate={() => {
			if (!source) return;
			// Rotate the SOURCE and re-render, rather than rotating the result:
			// resampling a binarized page softens every edge the threshold just
			// sharpened.
			//
			// The corners turn WITH it. They used to be discarded here, which
			// meant straightening a page also threw its crop away and handed back
			// the whole photograph, desk and all.
			const was = source.frame.height;
			source = {
				...source,
				frame: applyOrientation(source.frame, 6),
				corners: source.corners ? turnCorners(source.corners, was) : null
			};
			// The draft describes the frame as it was; rebuild it from the turned one.
			draft = null;
			void show(mode);
		}}
	/>
{/if}

{#if failure}
	<p class="status" role="alert">{failure}</p>
{/if}

<style>
	.reading {
		position: fixed;
		inset: 0;
		height: 100vh;
		height: 100dvh;
		z-index: 41;
		display: grid;
		place-items: center;
		align-content: center;
		gap: var(--space-2);
		background: var(--bg);
		color: var(--fg2);
		overflow: hidden;
		touch-action: none;
		overscroll-behavior: none;
	}
	.reading p {
		margin: 0;
	}
	.stage {
		font-size: var(--text-sm);
		color: var(--fg3);
		text-align: center;
		padding: 0 var(--space-6);
	}
	.status {
		position: fixed;
		z-index: 42;
		left: 50%;
		bottom: calc(var(--safe-bottom) + 132px);
		transform: translateX(-50%);
		margin: 0;
		padding: 0 var(--space-6);
		min-height: var(--touch-min);
		display: flex;
		align-items: center;
		border-radius: var(--radius-pill);
		background: var(--scan-plate);
		color: var(--scan-ink);
	}
</style>
