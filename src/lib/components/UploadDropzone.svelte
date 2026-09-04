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
		onfiles
	}: {
		accept?: string;
		multiple?: boolean;
		idleText: string;
		busyText?: string;
		/** The accepted formats, shown on hover. Not rendered inline: it would
		 *  cost every form a permanently taller control for an answer the user
		 *  needs once. */
		description?: string;
		/**
		 * Whether the dropzone shows the failure itself. False where the screen
		 * already renders the same message somewhere more prominent — the same
		 * error in two places reads as two separate failures.
		 */
		reportErrors?: boolean;
		/**
		 * The big version: an icon tile, a title and the formats spelled out.
		 *
		 * For a screen whose whole purpose IS the upload — Import — where the
		 * control has room and where a person arriving for the first time needs
		 * to be told what the app will accept. Everywhere else the dropzone is
		 * one field beside a date and a subject, and stays the compact one.
		 */
		hero?: boolean;
		/** The line under the title, saying what happens to what is dropped. */
		heroNote?: string;
		/** Format names printed as chips under the title. Hero only. */
		formats?: string[];
		/**
		 * Field mode. The file stays on this component's own input and the
		 * enclosing <form> posts it under this name, exactly as a raw
		 * <input type="file" name="…"> did. Nine of the twelve upload sites work
		 * this way: the file is one field beside a subject, an amount or a date,
		 * and submitting it on arrival would submit a half-filled form.
		 */
		name?: string;
		/** Callback mode. Fires on arrival and owns the submission itself. */
		onfiles?: (files: FileList | File[]) => Promise<ActionOutcome>;
	} = $props();

	let input: HTMLInputElement | undefined = $state();
	let dragging = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let chosen = $state<string[]>([]);
	let cameraInput: HTMLInputElement | undefined = $state();
	let scanning = $state(false);
	/**
	 * The scan flow, resolved ONCE and held.
	 *
	 * It must not be imported from the template. `{#await import(…)}` re-runs
	 * its expression whenever the block re-renders, and `import()` hands back a
	 * new promise each time — so the block invalidates itself and Svelte's flush
	 * loop never settles. That pegs the main thread: no error, no log, the tab
	 * just stops. A dev build throws `effect_update_depth_exceeded`; a
	 * production build has no such guard and simply freezes.
	 */
	let ScanFlow = $state<typeof import('$lib/scan/client/ScanFlow.svelte').default | null>(null);
	/** A dropped photograph waiting to go through the pipeline. */
	let incoming = $state<File[]>([]);
	let scanFailed = $state(false);

	async function openScanner() {
		// Once the chunk has failed, stop trying: a second stall helps nobody
		// when the camera app is right there.
		if (scanFailed) return void cameraInput?.click();
		if (!ScanFlow) {
			try {
				// Lazy, so the 10 MB of WASM behind this never reaches a visitor
				// who does not scan.
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

	/**
	 * No `scan` prop. `accept` already says whether a camera could help, and
	 * every call site passes it — so the payslip dialog (.pdf) draws no button
	 * without being told, and the sites that are not document uploads keep the
	 * plain input they always had. A second prop would only be needed for a
	 * dropzone that admits images but must not photograph them, and there is no
	 * such site.
	 */
	/**
	 * Two different jobs, so two different buttons.
	 *
	 * A PHOTOGRAPH is the thing itself — a picture of a meter reading, a receipt
	 * you want to look at later — and it should arrive untouched, as a JPEG.
	 * A SCAN is a document: cropped square, flattened, thresholded and written
	 * as a PDF. Cropping and binarising a photograph someone wanted as a
	 * photograph is destructive, and handing over a curled, shadowed snapshot
	 * when someone asked for a scan is useless. One button cannot be both.
	 */
	const offersPhoto = $derived(admitsImages(accept));
	const offersScan = $derived(admitsPdf(accept));

	/**
	 * The one place the two shapes meet. `onfiles` was typed FileList because a
	 * raw input is where files came from; the scan engine hands over a File it
	 * built in memory, and there is no FileList constructor.
	 */
	function list(files: FileList | File[]): File[] {
		return Array.from(files as ArrayLike<File>);
	}

	async function receive(files: FileList | File[]) {
		const picked = list(files);

		// A dropped photograph goes through the same pipeline as a captured one,
		// so both produce the same artifact — a cropped, flattened PDF rather
		// than a crooked snapshot of a desk. This is the path for photos someone
		// already has: a picture of a bill sent to them, something shot earlier
		// and still in the camera roll.
		//
		// PDFs pass through untouched; only images enter the pipeline. And only
		// ONE at a time: the spec has several dropped images becoming a single
		// PDF, but that needs the review screen to be meaningful, so until then a
		// multiple drop keeps the plain behaviour rather than half-doing it.
		if (offersScan && picked.length === 1 && isImageFile(picked[0])) {
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

	/**
	 * Move files onto the input by hand.
	 *
	 * Assigning `input.files` is the only way a <form> posts something the user
	 * dropped rather than browsed for, and DataTransfer is the sanctioned
	 * constructor for a FileList.
	 *
	 * The dispatch is not optional. Assigning `.files` fires NOTHING — so a
	 * browsed file ran every handler listening for a change and a dropped one
	 * ran none of them. That is not a dead drop target, which someone would
	 * notice: it is a drop that fills the field and silently skips the work
	 * choosing a file is supposed to start — reading a payslip, unlocking the
	 * "what these are" select. Firing the event here is what makes a drop and a
	 * browse the same event to everything downstream.
	 */
	function adopt(files: FileList | File[]) {
		if (!input) return;
		if (!name) return void receive(files); // callback mode: no field to fill
		const transfer = new DataTransfer();
		for (const file of list(files)) transfer.items.add(file);
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}
</script>

<div
	class="dropzone"
	class:hero
	class:dragging
	class:busy
	role="button"
	tabindex="0"
	aria-busy={busy}
	title={description}
	onclick={() => input?.click()}
	onkeydown={(event) => (event.key === 'Enter' || event.key === ' ') && input?.click()}
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={(event) => {
		event.preventDefault();
		dragging = false;
		if (!event.dataTransfer?.files.length) return;
		// `adopt` fires the input's own change event, which runs `receive` below
		// and reaches the enclosing form. Calling `receive` here as well would
		// run the callback twice for one drop.
		adopt(event.dataTransfer.files);
	}}
>
	{#if hero}
		<span class="hero-tile"><Icon name="inbox" size={24} /></span>
	{/if}
	<span class="title">{busy ? busyText : chosen.length ? chosen.join(', ') : idleText}</span>
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
		{#if offersScan}
			<button
				type="button"
				class="capture-btn"
				aria-label="Scan a document"
				title="Scan a document — cropped, flattened and saved as a PDF"
				onclick={(event) => {
					event.stopPropagation();
					// getUserMedia needs a secure context. Without one — a
					// self-hosted instance on a plain-http address — the phone's
					// own camera app still works and needs no such thing.
					if (isSecureForCamera(window.location)) void openScanner();
					else cameraInput?.click();
				}}
			>
				<Icon name="scan" size={18} />
			</button>
		{/if}
	{/if}

	<!--
		The native camera app, via `capture`. It needs no secure context, which
		matters: getUserMedia does, so a self-hosted Continuum on a plain-http LAN
		address can never open an in-app viewfinder. This path works there.

		The photo is moved onto the field input above, so it arrives exactly as a
		browsed or dropped file does and every handler downstream sees one event.
	-->
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
		onchange={() => input?.files?.length && void receive(input.files)}
	/>
</div>
{#if scanning && ScanFlow}
	<ScanFlow
		{incoming}
		onclose={() => {
			scanning = false;
			incoming = [];
		}}
		onchoosefile={() => {
			scanning = false;
			incoming = [];
			input?.click();
		}}
		ondone={(page) => {
			scanning = false;
			incoming = [];
			adopt([page]);
		}}
	/>
{/if}
{#if error && reportErrors}<p class="error" role="alert">{error}</p>{/if}

<style>
	/* One control tall, one line of copy.
	 *
	 * A 24px-padded two-line block is a panel, not a control: dropped into the
	 * settings config-row or the receipt modal it dwarfed the button beside it
	 * and read as a second, competing region. This stands on the same floor as
	 * every other control in the product — `--control-h`, `.btn`'s radius,
	 * padding and type size — so a dropzone and the button next to it line up
	 * without either being told about the other.
	 *
	 * The accepted formats live in `title`, not in a second line: they are the
	 * answer to a question the user only asks once, and paying for them with a
	 * permanently taller control in every form is the wrong trade.
	 */
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
	/* The one screen that IS an upload gets a target the size of the job.
	   Teal because Import belongs to Money, and the ground says "drop here"
	   before the sentence does. */
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
	/* The camera lives IN the row rather than under a rule below it. The design
	   put it below one, but that assumed the two-line panel this control used to
	   be; in a one-line control a rule would be a divider across nothing. */
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
	/*
	 * Capture is a phone and tablet job, so the two buttons are not offered to a
	 * mouse.
	 *
	 * `capture="environment"` is ignored by desktop browsers, so the photo
	 * button there opened the ordinary file picker — the same thing clicking the
	 * region already does. The scanner would open a webcam, which is a poor way
	 * to photograph a page and never the reason this exists.
	 *
	 * Nothing is lost by hiding them. A photo dropped or browsed on a computer
	 * still goes through the crop-flatten-PDF pipeline — see `receive` above —
	 * so the desktop route to a scan is the one it was always going to be: take
	 * the picture on your phone, put the file here.
	 *
	 * Three clauses, and each is load-bearing:
	 *
	 * `pointer: fine` and `hover: hover` describe the PRIMARY pointer, and they
	 * are what keeps a phone safe. A phone's primary pointer is never fine, so
	 * this rule cannot match one however the rest is read — and that matters
	 * more than tidiness on a desktop, because a phone that lost these would
	 * have lost the feature on the only device it is for.
	 *
	 * `not (any-pointer: coarse)` is what saves a TABLET. The primary pointer is
	 * the wrong question for one: an iPad on a Magic Keyboard, or a Surface
	 * under its type cover, answers "a trackpad" and would have been treated as
	 * a laptop by the first two clauses alone. `any-pointer` asks whether a
	 * finger is available AT ALL, which a tablet answers yes to whatever is
	 * plugged into it, and a stylus tablet answers yes to as well. A touchscreen
	 * laptop also answers yes and keeps a button it does not need, which is the
	 * cheaper of the two mistakes.
	 *
	 * Every way this can fail leaves the buttons SHOWING. On a browser too old
	 * for `not (…)` inside a media query the whole rule fails to parse and is
	 * dropped; on one that does not know `any-pointer` the clause is false and
	 * the rule falls back to the primary-pointer test, which a phone still fails.
	 */
	@media (pointer: fine) and (hover: hover) and (not (any-pointer: coarse)) {
		.capture-btn {
			display: none;
		}
	}
	/* 44px is a floor for FINGERS. On a mouse, 30px inside a 36px row is right
	   and matches every other control; on touch the row grows to meet the floor
	   rather than shipping a target nobody can hit. */
	@media (pointer: coarse) {
		.capture-btn {
			width: var(--touch-min);
			height: var(--touch-min);
			margin: -6px -9px;
		}
	}
	.title {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Visually hidden rather than display:none. A named input a form posts must
	   stay in the accessibility tree — display:none removes it from the tab
	   order AND from screen readers, and the region above is its only label. */
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
