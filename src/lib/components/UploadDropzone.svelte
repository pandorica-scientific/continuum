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
		onfiles
	}: {
		accept?: string;
		multiple?: boolean;
		idleText: string;
		busyText?: string;
		description?: string;
		/**
		 * Whether the dropzone shows the failure itself. False where the screen
		 * already renders the same message somewhere more prominent — the same
		 * error in two places reads as two separate failures.
		 */
		reportErrors?: boolean;
		onfiles: (files: FileList) => Promise<ActionOutcome>;
	} = $props();

	let input: HTMLInputElement | undefined = $state();
	let dragging = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function receive(files: FileList) {
		error = null;
		busy = true;
		try {
			const outcome = await onfiles(files);
			if (outcome.type !== 'success') error = outcome.message ?? 'The upload did not complete.';
		} finally {
			busy = false;
			if (input) input.value = '';
		}
	}
</script>

<div
	class="dropzone"
	class:dragging
	class:busy
	role="button"
	tabindex="0"
	aria-busy={busy}
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
		if (event.dataTransfer?.files.length) void receive(event.dataTransfer.files);
	}}
>
	<span class="title">{busy ? busyText : idleText}</span>
	{#if !busy && description}<span class="description">{description}</span>{/if}
	<input
		bind:this={input}
		type="file"
		{accept}
		{multiple}
		style="display: none"
		onchange={() => input?.files?.length && void receive(input.files)}
	/>
</div>
{#if error && reportErrors}<p class="error" role="alert">{error}</p>{/if}

<style>
	.dropzone {
		border: 1.5px dashed var(--bd2);
		border-radius: var(--radius-xl);
		padding: 24px;
		cursor: pointer;
	}
	.dropzone.dragging {
		background: var(--card2);
		border-color: var(--blue);
	}
	.dropzone.busy {
		cursor: progress;
		opacity: 0.75;
	}
	.title {
		display: block;
	}
	.description {
		display: block;
		margin-top: 7px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.error {
		margin: 8px 0 0;
		color: var(--red);
		font-size: var(--text-sm);
	}
</style>
