<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import type { ActionOutcome } from '$lib/actions/result';

	let {
		accept,
		multiple = false,
		idleText,
		busyText = 'Uploading…',
		description,
		reportErrors = true,
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
		const transfer = new DataTransfer();
		for (const file of list(files)) transfer.items.add(file);
		input.files = transfer.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}
</script>

<div
	class="dropzone"
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
	<span class="title">{busy ? busyText : chosen.length ? chosen.join(', ') : idleText}</span>
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
		border-radius: var(--radius-md);
		font-size: var(--text-md);
		line-height: 1.35;
		color: var(--fg2);
		cursor: pointer;
	}
	.dropzone:hover {
		border-color: var(--bd2);
		color: var(--fg1);
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
