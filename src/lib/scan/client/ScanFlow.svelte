<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// The one component a call site mounts. It owns which screen is showing.
	//
	// The render happens immediately after capture, while the user is looking at
	// the preview — not batched at the end. It costs about a second a page, and
	// paid there it is invisible.

	import {
		applyOrientation,
		assemblePdf,
		detectOnce,
		renderPage,
		scaleCorners,
		type Corners,
		type Frame,
		type PageMode,
		type PageSource
	} from '../core/index.ts';
	import { loadCv } from './opencv-load.ts';
	import {
		encodeJpeg,
		frameFromBitmap,
		frameFromBitmapSource,
		frameFromFile,
		frameToBlob
	} from './frame.ts';
	import ScanCapture from './ScanCapture.svelte';
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
	let screen = $state<'capture' | 'preview' | 'review' | 'reading'>(
		incoming.length ? 'reading' : 'capture'
	);
	const session = createSession();
	let busy = $state(false);
	let failure = $state<string | null>(null);

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

	/** The full-resolution capture, kept only while the preview is open. */
	let source = $state<{ frame: Frame; corners: Corners | null; from: PageSource } | null>(null);
	/** Remembered past `discard()`, which clears the source it came from. */
	let fromUpload = $state(false);
	/** The same, scaled down, for everything the preview needs. */
	let draft = $state<{ frame: Frame; corners: Corners | null } | null>(null);
	let mode = $state<PageMode>('bw');
	let previewUrl = $state('');

	function releasePreview() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = '';
	}

	/** Render the held capture in the chosen mode and show it. */
	async function show(next: PageMode) {
		if (!source) return;
		busy = true;
		failure = null;
		try {
			const cv = await loadCv();
			// Built once per capture, then reused for every mode switch.
			if (!draft) {
				const small = frameFromBitmapSource(source.frame, PREVIEW_WIDTH);
				draft = {
					frame: small,
					corners: source.corners
						? scaleCorners(source.corners, small.width / source.frame.width)
						: null
				};
			}
			// A failed detection degrades to the full frame inside renderPage —
			// never to an error, because there is nothing else the user could do
			// about it. `original` skips the warp entirely, which is what makes it
			// the recovery when the edges came out wrong.
			const page = renderPage(cv, draft.frame, draft.corners, next);
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
			const blob = await frameToBlob(page, mode === 'bw' ? 'image/png' : 'image/jpeg');
			session.add(mode, blob);
			discard();
			// A dropped photo has no viewfinder to go back to, and a full document
			// has nowhere further to go: both land on the review screen. Otherwise
			// return to the camera, which is what someone scanning a stack wants.
			screen = fromUpload || session.full ? 'review' : 'capture';
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
				{ title: name, encodeJpeg }
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
			const frame = await frameFromFile(file);
			const cv = await loadCv();
			const found = detectOnce(cv, frame, { gates: false, refine: true });
			source = { frame, corners: 'corners' in found ? found.corners : null, from: 'upload' };
			fromUpload = true;
			await show('bw');
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That photo could not be read.';
			screen = 'capture';
		}
	}

	$effect(() => {
		const [file] = incoming;
		if (file) void readDropped(file);
	});
</script>

{#if screen === 'reading'}
	<div class="reading">
		<p>Reading photo…</p>
	</div>
{:else if screen === 'review'}
	<ScanReview
		pages={session.pages}
		filename={session.filename}
		{busy}
		onmove={session.move}
		onremove={session.remove}
		onrename={session.rename}
		onadd={() => (screen = 'capture')}
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
				discard();
				(onchoosefile ?? onclose)();
				return;
			}
			replace();
		}}
		onmode={(next) => void show(next)}
		onrotate={() => {
			if (!source) return;
			// Rotate the SOURCE and re-render, rather than rotating the result:
			// resampling a binarized page softens every edge the threshold just
			// sharpened. The corners no longer apply once the frame has turned.
			source = { ...source, frame: applyOrientation(source.frame, 6), corners: null };
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
		background: var(--bg);
		color: var(--fg2);
		overflow: hidden;
		touch-action: none;
		overscroll-behavior: none;
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
