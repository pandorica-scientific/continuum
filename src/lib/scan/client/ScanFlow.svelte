<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// The one component a call site mounts. It owns which screen is showing and
	// does the per-page render.
	//
	// The render happens right after capture, while the user is still looking at
	// the result — not batched at the end. The work is about a second a page,
	// and paid there it is invisible.

	import { assemblePdf, renderPage, type Corners, type Frame } from '../core/index.ts';
	import { loadCv } from './opencv-load.ts';
	import { encodeJpeg } from './frame.ts';
	import ScanCapture from './ScanCapture.svelte';

	let {
		onclose,
		ondone
	}: {
		onclose: () => void;
		/** The finished page, handed to whatever the call site already does with a file. */
		ondone: (file: File) => void | Promise<void>;
	} = $props();

	let busy = $state(false);
	let failure = $state<string | null>(null);

	async function capture(frame: Frame, corners: Corners | null) {
		busy = true;
		failure = null;
		try {
			const cv = await loadCv();
			// A failed detection degrades to the full frame inside renderPage —
			// never to an error, because there is nothing else the user could do
			// about it.
			const page = renderPage(cv, frame, corners, 'bw');
			// A scan is a PDF. That is the whole distinction from the photo
			// button beside it, and it is why the page is embedded at one bit per
			// pixel rather than handed over as an image file.
			const bytes = await assemblePdf([{ frame: page, mode: 'bw' }], {
				title: filename(),
				encodeJpeg
			});
			await ondone(new File([bytes], `${filename()}.pdf`, { type: 'application/pdf' }));
			onclose();
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That page could not be processed.';
		} finally {
			busy = false;
		}
	}

	const filename = () => `Scan ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
</script>

<ScanCapture
	oncapture={(frame, corners) => void capture(frame, corners)}
	oncancel={onclose}
	onchoosefile={onclose}
/>

{#if busy || failure}
	<p class="status" role="status">{failure ?? 'Cleaning up the page'}</p>
{/if}

<style>
	.status {
		position: fixed;
		z-index: 41;
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
