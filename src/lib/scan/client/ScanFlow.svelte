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
		renderPage,
		type Corners,
		type Frame,
		type PageMode,
		type PageSource
	} from '../core/index.ts';
	import { loadCv } from './opencv-load.ts';
	import { encodeJpeg, frameToBlob } from './frame.ts';
	import ScanCapture from './ScanCapture.svelte';
	import ScanPagePreview from './ScanPagePreview.svelte';

	let {
		onclose,
		ondone
	}: {
		onclose: () => void;
		/** The finished page, handed to whatever the call site already does with a file. */
		ondone: (file: File) => void | Promise<void>;
	} = $props();

	let screen = $state<'capture' | 'preview'>('capture');
	let busy = $state(false);
	let failure = $state<string | null>(null);

	/** The full-resolution capture, kept only while the preview is open. */
	let source = $state<{ frame: Frame; corners: Corners | null; from: PageSource } | null>(null);
	let mode = $state<PageMode>('bw');
	let rendered = $state<Frame | null>(null);
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
			// A failed detection degrades to the full frame inside renderPage —
			// never to an error, because there is nothing else the user could do
			// about it. `original` skips the warp entirely, which is what makes it
			// the recovery when the edges came out wrong.
			const page = renderPage(cv, source.frame, source.corners, next);
			releasePreview();
			// PNG for a binarized page: lossless, and JPEG ringing around black
			// text on white is the one artefact that costs legibility.
			previewUrl = URL.createObjectURL(
				await frameToBlob(page, next === 'bw' ? 'image/png' : 'image/jpeg')
			);
			rendered = page;
			mode = next;
			screen = 'preview';
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That page could not be processed.';
		} finally {
			busy = false;
		}
	}

	async function keep() {
		if (!rendered) return;
		busy = true;
		try {
			// A scan is a PDF. That is the whole distinction from the photo button
			// beside it, and why a bw page is embedded at one bit per pixel.
			const bytes = await assemblePdf([{ frame: rendered, mode }], {
				title: filename(),
				encodeJpeg
			});
			await ondone(new File([bytes], `${filename()}.pdf`, { type: 'application/pdf' }));
			discard();
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
		rendered = null;
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

	const filename = () => `Scan ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
</script>

{#if screen === 'capture'}
	<ScanCapture
		oncapture={(frame, corners) => {
			source = { frame, corners, from: 'camera' };
			void show('bw');
		}}
		oncancel={() => {
			discard();
			onclose();
		}}
		onchoosefile={() => {
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
		onreplace={replace}
		onmode={(next) => void show(next)}
		onrotate={() => {
			if (!source) return;
			// Rotate the SOURCE and re-render, rather than rotating the result:
			// resampling a binarized page softens every edge the threshold just
			// sharpened. The corners no longer apply once the frame has turned.
			source = { ...source, frame: applyOrientation(source.frame, 6), corners: null };
			void show(mode);
		}}
	/>
{/if}

{#if failure}
	<p class="status" role="alert">{failure}</p>
{/if}

<style>
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
