<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { ActionOutcome } from '$lib/actions/result';
	import Icon from '$lib/components/Icon.svelte';
	import { admitsImages, admitsPdf, isImageFile } from '$lib/scan/core/accept';
	import { isSecureForCamera } from '$lib/scan/client/camera.svelte';

	let {
		accept,
		multiple = false,
		idleText,
		busyText = 'Uploading…',
		description,
		reportErrors = true,
		hero = false,
		heroNote,
		formats = [],
		name,
		onfiles,
		crop = false
	}: {
		accept?: string;
		multiple?: boolean;
		idleText: string;
		busyText?: string;
		/** The accepted formats, shown on hover. Not rendered inline: it would
		 *  cost every form a permanently taller control for an answer the user
		 *  needs once. */
		description?: string;
		/** False where the screen already renders the same message elsewhere,
		 *  more prominently — avoids showing one failure twice. */
		reportErrors?: boolean;
		/** The big version — icon tile, title, formats spelled out — for a
		 *  screen whose whole purpose is the upload (Import). */
		hero?: boolean;
		/** The line under the title, saying what happens to what is dropped. */
		heroNote?: string;
		/** Format names printed as chips under the title. Hero only. */
		formats?: string[];
		/** Field mode: the file stays on this component's own input and the
		 *  enclosing <form> posts it under this name, like a raw file input. */
		name?: string;
		/** Callback mode. Fires on arrival and owns the submission itself. */
		onfiles?: (files: FileList | File[]) => Promise<ActionOutcome>;
		/** Offer the crop editor for a picture rather than a document — same
		 *  camera and crop, stopping before thresholding/PDF conversion. */
		crop?: boolean;
	} = $props();

	let input: HTMLInputElement | undefined = $state();
	let dragging = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let chosen = $state<string[]>([]);
	let cameraInput: HTMLInputElement | undefined = $state();
	/** Holds the uncropped photograph, where the call site asked for it. */
	let originalInput: HTMLInputElement | undefined = $state();
	let scanning = $state(false);
	/** Resolved once and held — must not be imported from the template.
	 *  `{#await import(…)}` gets a new promise on every re-render, which
	 *  invalidates the block forever and freezes the tab with no error. */
	let ScanFlow = $state<typeof import('$lib/scan/client/ScanFlow.svelte').default | null>(null);
	/** A dropped photograph waiting to go through the pipeline. */
	let incoming = $state<File[]>([]);
	let scanFailed = $state(false);

	async function openScanner() {
		// Once the chunk has failed, stop trying — fall back to the camera app.
		if (scanFailed) return void cameraInput?.click();
		if (!ScanFlow) {
			try {
				ScanFlow = (await import('$lib/scan/client/ScanFlow.svelte')).default;
			} catch {
				// The chunk did not load. Fall back to the camera app rather than
				// leaving the button dead.
				scanFailed = true;
				cameraInput?.click();
				return;
			}
		}
		scanning = true;
	}

	// A photograph should arrive untouched (as a JPEG); a scan is a document —
	// cropped, flattened, thresholded, written as a PDF. One button can't be both.
	const offersScan = $derived(admitsPdf(accept));
	/** The crop button: a document scan, or a picture that wants the same editor. */
	const offersCrop = $derived(offersScan || (crop && admitsImages(accept)));
	/** Not shown when `crop` already routes photos through the same editor. */
	const offersPhoto = $derived(admitsImages(accept) && !crop);

	/** `onfiles` is typed FileList because a raw input is where files came
	 *  from; the scan engine hands over a File built in memory instead. */
	function list(files: FileList | File[]): File[] {
		return Array.from(files as ArrayLike<File>);
	}

	/** A dropped photograph goes through the same editor pipeline as a
	 *  captured one. Only one at a time — several images becoming one PDF
	 *  needs a review screen that doesn't exist yet. */
	const wantsEditor = (picked: File[]): boolean =>
		offersCrop && picked.length === 1 && isImageFile(picked[0]);

	/** Set while a file the editor just produced is being put on the field —
	 *  without this, `wantsEditor` would feed the crop straight back into
	 *  the editor that made it. */
	let fromEditor = false;

	async function receive(files: FileList | File[]) {
		const picked = list(files);

		if (!fromEditor && wantsEditor(picked)) {
			incoming = picked;
			await openScanner();
			return;
		}

		chosen = picked.map((file) => file.name);
		if (!onfiles) return; // field mode: the form posts it, nothing to do now
		error = null;
		busy = true;
		try {
			const outcome = await onfiles(picked);
			if (outcome.type !== 'success') error = outcome.message ?? 'The upload did not complete.';
		} finally {
			busy = false;
			chosen = [];
			if (input) input.value = '';
		}
	}

	/** Puts the uncropped photograph on the `<name>Original` companion field,
	 *  so one capture yields both the whole frame and the crop in one submit. */
	function keepOriginal(file: File) {
		if (!originalInput) return;
		const transfer = new DataTransfer();
		transfer.items.add(file);
		originalInput.files = transfer.files;
	}

	/**
	 * `edited` marks a file the editor has already finished with. Everything
	 * else — the camera button, a plain drop — is still a candidate for it.
	 */
	function adopt(files: FileList | File[], edited = false) {
		if (!input) return;
		fromEditor = edited;
		try {
			if (!name) return void receive(files); // callback mode: no field to fill
			const transfer = new DataTransfer();
			for (const file of list(files)) transfer.items.add(file);
			input.files = transfer.files;
			// Assigning `.files` fires no event, so a drop would silently skip
			// the work a change normally starts — dispatch it by hand.
			input.dispatchEvent(new Event('change', { bubbles: true }));
		} finally {
			fromEditor = false;
		}
	}
</script>

<!-- The keyboard's way in is the button inside; not a button itself, since
     that would nest the camera/scan buttons and file field in one control. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="dropzone"
	class:hero
	class:dragging
	class:busy
	aria-busy={busy}
	title={description}
	onclick={() => input?.click()}
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(event) => {
		event.preventDefault();
		dragging = false;
		if (!event.dataTransfer?.files.length) return;
		// `adopt` fires the input's change event, which runs `receive` — calling
		// it here too would run the callback twice for one drop.
		adopt(event.dataTransfer.files);
	}}
>
	{#if hero}
		<span class="hero-tile"><Icon name="inbox" size={24} /></span>
	{/if}
	<button
		type="button"
		class="title"
		onclick={(event) => {
			// The zone's own click would open the browser a second time.
			event.stopPropagation();
			input?.click();
		}}
	>
		{busy ? busyText : chosen.length ? chosen.join(', ') : idleText}
	</button>
	{#if hero && heroNote && !busy}
		<span class="hero-note">{heroNote}</span>
	{/if}
	{#if hero && formats.length > 0 && !busy}
		<span class="formats">
			{#each formats as f (f)}<span class="format mono">{f}</span>{/each}
		</span>
	{/if}
	{#if !busy && !dragging}
		{#if offersPhoto}
			<button
				type="button"
				class="capture-btn"
				aria-label="Take a photo"
				title="Take a photo — kept as it is"
				onclick={(event) => {
					// This button sits inside a region that is itself clickable.
					// Without this, tapping it also opens the file browser behind.
					event.stopPropagation();
					cameraInput?.click();
				}}
			>
				<Icon name="camera" size={18} />
			</button>
		{/if}
		{#if offersCrop}
			<button
				type="button"
				class="capture-btn"
				aria-label={crop ? 'Photograph it' : 'Scan a document'}
				title={crop
					? 'Photograph it — crop to the edges or keep the whole frame, in colour or not'
					: 'Scan a document — cropped, flattened and saved as a PDF'}
				onclick={(event) => {
					event.stopPropagation();
					// getUserMedia needs a secure context; a plain-http self-hosted
					// instance falls back to the native camera app, which needs none.
					if (isSecureForCamera(window.location)) void openScanner();
					else cameraInput?.click();
				}}
			>
				<Icon name={crop ? 'camera' : 'scan'} size={18} />
			</button>
		{/if}
	{/if}

	{#if crop && name}
		<input
			bind:this={originalInput}
			class="field"
			type="file"
			name="{name}Original"
			tabindex="-1"
			aria-hidden="true"
		/>
	{/if}

	<!-- Native camera app via `capture` — needs no secure context, unlike
	     getUserMedia, so this works on a plain-http self-hosted instance. -->
	<input
		bind:this={cameraInput}
		class="field"
		type="file"
		accept="image/*"
		capture="environment"
		tabindex="-1"
		aria-hidden="true"
		onchange={() => {
			if (cameraInput?.files?.length) adopt(cameraInput.files);
			if (cameraInput) cameraInput.value = '';
		}}
	/>
	<input
		bind:this={input}
		class="field"
		type="file"
		{name}
		{accept}
		{multiple}
		tabindex="-1"
		aria-label={idleText}
		onchange={() => input?.files?.length && void receive(input.files)}
	/>
</div>
{#if scanning && ScanFlow}
	<ScanFlow
		{incoming}
		finish={crop ? 'picture' : 'document'}
		onclose={() => {
			scanning = false;
			incoming = [];
		}}
		onchoosefile={() => {
			scanning = false;
			incoming = [];
			input?.click();
		}}
		ondone={(page, original) => {
			scanning = false;
			incoming = [];
			if (original) keepOriginal(original);
			adopt([page], true);
		}}
	/>
{/if}
{#if error && reportErrors}<p class="error" role="alert">{error}</p>{/if}

<style>
	/* One control tall, one line of copy — matches --control-h so a dropzone
	 * lines up with the button next to it. Accepted formats live in `title`,
	 * not a second line, since that's a question asked only once. */
	.dropzone {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-height: var(--control-h);
		padding: 7px 13px;
		border: 1.5px dashed var(--bd2);
		border-radius: var(--radius-ctl);
		font-size: var(--text-md);
		line-height: 1.35;
		color: var(--fg2);
		cursor: pointer;
	}
	.dropzone:hover {
		border-color: color-mix(in srgb, var(--teal) 45%, transparent);
		background: var(--teal-wash);
		color: var(--fg1);
	}
	/* Teal because Import belongs to Money. */
	.dropzone.hero {
		flex-direction: column;
		justify-content: center;
		gap: var(--space-5);
		padding: 34px var(--space-8);
		border-radius: var(--radius-card);
		border-color: color-mix(in srgb, var(--teal) 45%, var(--bd2));
		background: var(--teal-wash);
		text-align: center;
	}
	.dropzone.hero .title {
		font-size: 15px;
		font-weight: 600;
		color: var(--fg1);
	}
	.hero-note {
		font-size: 12.5px;
		color: var(--fg3);
		line-height: 1.5;
	}
	.hero-tile {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: color-mix(in srgb, var(--teal) var(--tile-alpha-active), transparent);
		color: var(--teal);
	}
	.formats {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-3);
	}
	.format {
		font-size: var(--text-xs);
		padding: 2px var(--space-5);
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		color: var(--fg3);
	}
	.dropzone:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
	.dropzone.dragging {
		background: var(--blue-wash);
		border-color: var(--blue);
		color: var(--fg1);
	}
	.dropzone.busy {
		cursor: progress;
		opacity: 0.75;
	}
	.capture-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 30px;
		height: 30px;
		margin: -4px -6px -4px 0;
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--fg3);
		cursor: pointer;
	}
	.capture-btn:hover {
		background: var(--card2);
		color: var(--fg1);
	}
	.capture-btn:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
	/* Capture is a phone/tablet job; hidden on a mouse where `capture` is
	 * ignored and the scanner would just open a webcam.
	 *
	 * Three load-bearing clauses: `pointer: fine`/`hover: hover` test the
	 * PRIMARY pointer, which keeps a phone safe. `not (any-pointer: coarse)`
	 * saves a TABLET — an iPad on a keyboard reports "trackpad" as primary,
	 * so `any-pointer` (any finger available at all) is needed to catch it.
	 * Every failure mode of this query leaves the buttons showing. */
	@media (pointer: fine) and (hover: hover) and (not (any-pointer: coarse)) {
		.capture-btn {
			display: none;
		}
	}
	/* 44px is a floor for fingers; on touch the row grows to meet it. */
	@media (pointer: coarse) {
		.capture-btn {
			width: var(--touch-min);
			height: var(--touch-min);
			margin: -6px -9px;
		}
	}
	.title {
		appearance: none;
		border: 0;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
		text-align: center;
	}
	.title:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
		border-radius: var(--radius-sm);
	}
	.title {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Visually hidden, not display:none — the latter drops it from the tab
	   order and screen readers, and the region above is its only label. */
	.field {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.error {
		margin: 8px 0 0;
		color: var(--red);
		font-size: var(--text-sm);
	}
</style>
