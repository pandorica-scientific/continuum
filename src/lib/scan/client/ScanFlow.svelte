<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The one component a call site mounts. It owns which screen is showing.
	//
	// Every pixel operation now happens on the server. What is left here is the
	// journey — camera, inspect, corners, keep, add or retake, done — which is
	// deliberately unchanged: the same screens in the same order, doing the same
	// things. Only where the work happens moved.
	//
	// THE PHOTOGRAPH IS A CACHE, NOT STORAGE. The file the camera produced is
	// held only while its page is on the inspection or corner screen, so the
	// corner handles can be drawn over the phone's own copy without fetching
	// anything. The moment the page is kept it is released, and what remains is
	// a preview URL of a couple of hundred kilobytes. Coming back to re-edge a
	// kept page fetches the original again, which is rare and cheap; holding
	// twenty photographs to make it free would cost 60 MB on the device least
	// able to spare it.

	import { type Line, type Outline, type PageMode, type Rotation } from '../core/index.ts';
	import { isSecureForCamera } from './camera.svelte.ts';
	import {
		assembleScanDocument,
		dropScanPage,
		dropScanSession,
		keepScanPage,
		originalUrl,
		previewUrl,
		renderScanPage,
		uploadScanPage
	} from './api.ts';
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
	 * moment" is worth showing.
	 */
	let stage = $state('');

	/** The page currently being inspected, as the server and the phone each see it. */
	interface Held {
		pageId: string;
		outline: Outline | null;
		/** The straight edges the detector fitted, for the corner screen to snap to. */
		lines: Line[];
		rotation: Rotation;
		width: number;
		height: number;
		from: 'camera' | 'upload';
		/** The phone's own copy of the photograph. Released the moment it is kept. */
		file: File | null;
		/** An object URL onto `file`, for the corner screen. */
		localUrl: string;
	}

	let held = $state<Held | null>(null);
	let mode = $state<PageMode>('bw');
	/** Bumped on every render so the preview URL is a new one to the browser. */
	let token = $state(0);
	let fromUpload = $state(false);

	const preview = $derived(held && session.id ? previewUrl(session.id, held.pageId, token) : '');

	/** What the corner screen draws on: the phone's copy, or the server's if it has none. */
	let cornersUrl = $state('');

	function releaseLocal() {
		if (held?.localUrl) URL.revokeObjectURL(held.localUrl);
	}

	/**
	 * Where the next page comes from. The in-page viewfinder needs a secure
	 * context, which a self-hosted Continuum on a plain-http address never
	 * has; there, every page comes from the phone's own camera app instead,
	 * through the input below, and lands on the same pipeline.
	 */
	const viewfinder = typeof window !== 'undefined' && isSecureForCamera(window.location);
	let cameraInput = $state<HTMLInputElement | null>(null);
	function nextPage() {
		if (viewfinder) screen = 'capture';
		else cameraInput?.click();
	}

	/**
	 * Send a photograph up and show what comes back.
	 *
	 * The upload is the only thing the phone does with the file besides display
	 * it. A 12 MP HEIC that used to be decoded here — 3.6 seconds, and the
	 * allocation that failed on iOS — is now bytes on a socket.
	 */
	async function read(file: File) {
		screen = 'reading';
		failure = null;
		busy = true;
		try {
			stage = 'Sending the photo…';
			const page = await uploadScanPage(file, session.id);
			session.id = page.sessionId;
			stage = 'Finding the page…';

			releaseLocal();
			held = {
				pageId: page.pageId,
				outline: page.outline,
				lines: page.lines,
				rotation: 0,
				width: page.width,
				height: page.height,
				from: fromUpload ? 'upload' : 'camera',
				file,
				localUrl: URL.createObjectURL(file)
			};
			mode = 'bw';
			token++;
			screen = 'preview';
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That photo could not be read.';
			screen = viewfinder ? 'capture' : 'review';
		} finally {
			busy = false;
			stage = '';
		}
	}

	/** Ask the server for this page in another mode, or at new corners. */
	async function show(
		next: PageMode,
		outline = held?.outline ?? null,
		rotation = held?.rotation ?? 0
	) {
		if (!held || !session.id) return;
		busy = true;
		failure = null;
		try {
			await renderScanPage({
				sessionId: session.id,
				pageId: held.pageId,
				mode: next,
				outline,
				rotation
			});
			held = { ...held, outline, rotation };
			mode = next;
			token++;
			screen = 'preview';
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That page could not be processed.';
		} finally {
			busy = false;
		}
	}

	/**
	 * Show the photograph with handles on it.
	 *
	 * The phone's own copy is used when it still has one, which is the common
	 * case and costs nothing. A page that was already kept has released its
	 * file, and a HEIC that this browser will not decode never displayed in the
	 * first place — both fall through to the server's downscaled original, which
	 * is what that endpoint exists for.
	 */
	function openCorners() {
		if (!held || !session.id) return;
		cornersUrl = held.localUrl || originalUrl(session.id, held.pageId);
		screen = 'corners';
	}

	/** The local copy would not display. Ask the server for one that will. */
	function cornersFallback() {
		if (!held || !session.id) return;
		cornersUrl = originalUrl(session.id, held.pageId);
	}

	/**
	 * Render at full resolution, store the artefact, and add the page.
	 *
	 * This is where the phone lets go of the photograph: the document has it
	 * now, and holding twenty of them is the memory problem this release exists
	 * to remove.
	 */
	async function keep() {
		if (!held || !session.id) return;
		busy = true;
		failure = null;
		try {
			await keepScanPage({
				sessionId: session.id,
				pageId: held.pageId,
				mode,
				outline: held.outline,
				rotation: held.rotation
			});
			session.add(held.pageId, mode, previewUrl(session.id, held.pageId, token));
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
		if (session.pages.length === 0 || !session.id) return;
		busy = true;
		failure = null;
		try {
			const file = await assembleScanDocument(
				session.id,
				session.pages.map((page) => page.id),
				session.filename
			);
			await ondone(file);
			session.dispose();
			onclose();
		} catch (error) {
			failure = error instanceof Error ? error.message : 'That PDF could not be built.';
		} finally {
			busy = false;
		}
	}

	/** Back to the viewfinder. Nothing is lost by trying again. */
	function replace() {
		retake();
		screen = 'capture';
	}

	function discard() {
		releaseLocal();
		held = null;
		cornersUrl = '';
		mode = 'bw';
	}

	/**
	 * Discard the page being inspected, on the server as well as here.
	 *
	 * The replacement is uploaded into the SAME session, so a page dropped
	 * without saying so stays on disk as its full-size original until the
	 * document is made — twice the scratch for a page photographed twice, and
	 * more for a difficult one. `discard()` on its own is for a page that is
	 * staying, which is the one the keep path has just committed.
	 */
	function retake() {
		if (held && session.id) dropScanPage(session.id, held.pageId);
		discard();
	}

	/** Give the server back its scratch, whenever this screen is left for good. */
	function abandon() {
		if (session.id) dropScanSession(session.id);
		session.dispose();
		discard();
	}

	/**
	 * Hold the page still underneath.
	 *
	 * `overflow: hidden` on the body is the obvious lock and it does not work on
	 * iOS Safari — touch scrolling ignores it. The technique that does work is to
	 * pin the body with `position: fixed` at its current offset, which takes it
	 * out of flow entirely so there is nothing left to scroll, then put the
	 * offset back on the way out.
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
	 * The scratch goes back however the screen ends, not only when Cancel is
	 * pressed.
	 *
	 * Closing the tab, a phone that goes flat, a call site that unmounts this
	 * component — all of them are the end of the scan as far as the server is
	 * concerned, and none of them reach `abandon()`. The sweep is the backstop
	 * and runs two hours later; this is the same request at the moment the screen
	 * goes away, which is what `keepalive` on that fetch is for. It is a no-op
	 * once a document has been made: `make()` disposes the session first, so
	 * there is no id left to drop.
	 */
	$effect(() => {
		const leave = () => {
			if (session.id) dropScanSession(session.id);
		};
		window.addEventListener('pagehide', leave);
		return () => {
			window.removeEventListener('pagehide', leave);
			leave();
		};
	});

	$effect(() => {
		const [file] = incoming;
		if (file) {
			fromUpload = true;
			void read(file);
		}
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
		if (file) void read(file);
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
			abandon();
			onclose();
		}}
	/>
{:else if screen === 'capture'}
	<ScanCapture
		pageCount={session.pages.length}
		thumbnail={session.pages.at(-1)?.previewUrl ?? null}
		oncapture={(file) => void read(file)}
		onreview={() => (screen = 'review')}
		oncancel={() => {
			// Pages already kept are not thrown away silently: if there are any,
			// Cancel goes to the review screen where discarding is a deliberate act.
			if (session.pages.length > 0) {
				retake();
				screen = 'review';
				return;
			}
			abandon();
			onclose();
		}}
		onchoosefile={() => {
			abandon();
			onclose();
		}}
	/>
{:else if screen === 'corners' && held}
	<ScanCorners
		imageUrl={cornersUrl}
		width={held.width}
		height={held.height}
		outline={held.outline}
		lines={held.lines}
		onunavailable={cornersFallback}
		onapply={(next) => void show(mode, next)}
		oncancel={() => {
			cornersUrl = '';
			screen = 'preview';
		}}
	/>
{:else if held}
	<ScanPagePreview
		previewUrl={preview}
		{mode}
		{busy}
		source={held.from}
		onkeep={() => void keep()}
		onreplace={() => {
			// On the upload path there is no viewfinder to return to, so Replace
			// means "pick a different file" and the button says so.
			if (held?.from === 'upload') {
				// But the pages already kept are not this photograph's to throw
				// away. Handing back to the call site UNMOUNTS this component and
				// the session goes with it, so retaking a page you did not like
				// silently cost you every page behind it. Retake in place instead
				// and leave the document alone.
				if (session.pages.length > 0) {
					retake();
					// Somewhere to land if the camera is dismissed: the review
					// screen, still holding the pages that never went anywhere.
					screen = 'review';
					nextPage();
					return;
				}
				abandon();
				(onchoosefile ?? onclose)();
				return;
			}
			replace();
		}}
		onmode={(next) => void show(next)}
		onedges={openCorners}
		onrotate={() => {
			if (!held) return;
			// Rotate the SOURCE and re-render, rather than rotating the result:
			// resampling a binarized page softens every edge the threshold just
			// sharpened. The server turns the corners with it, so straightening a
			// page no longer throws its crop away.
			const turned = ((held.rotation + 90) % 360) as Rotation;
			void show(mode, held.outline, turned);
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
