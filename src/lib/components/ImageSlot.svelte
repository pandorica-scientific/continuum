<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { submitAction } from '$lib/actions/result';

	let {
		propertyId,
		slot,
		image,
		placeholder,
		fit = 'cover',
		onview
	}: {
		propertyId: string;
		slot: string;
		image: string | undefined;
		placeholder: string;
		fit?: 'cover' | 'contain';
		/** open the image in the page's lightbox; without it, falls back to a new tab */
		onview?: (image: string) => void;
	} = $props();

	let input: HTMLInputElement | undefined = $state();
	let confirming = $state(false);
	let dragOver = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function upload(file: File) {
		const body = new FormData();
		body.set('propertyId', propertyId);
		body.set('slot', slot);
		body.set('expectedImage', image ?? '');
		body.set('file', file);
		busy = true;
		try {
			const outcome = await submitAction('/property?/uploadImage', body);
			error = outcome.type === 'success' ? null : outcome.message;
		} finally {
			busy = false;
		}
	}

	// Two taps rather than a browser confirm(): a modal dialog inside a drop
	// target is easy to dismiss by accident, and this deletes a file.
	async function remove() {
		if (!confirming) {
			confirming = true;
			return;
		}
		const body = new FormData();
		body.set('propertyId', propertyId);
		body.set('slot', slot);
		body.set('expectedImage', image ?? '');
		busy = true;
		try {
			const outcome = await submitAction('/property?/removeImage', body);
			error = outcome.type === 'success' ? null : outcome.message;
		} finally {
			busy = false;
			confirming = false;
		}
	}
</script>

{#if image}
	<!-- A filled slot opens the full, uncropped image; replace via the corner button. -->
	<div
		class="slot filled"
		role="group"
		ondragover={(e) => {
			e.preventDefault();
			dragOver = true;
		}}
		ondragleave={() => (dragOver = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragOver = false;
			const file = e.dataTransfer?.files?.[0];
			if (file) upload(file);
		}}
	>
		{#if onview}
			<button
				type="button"
				class="view"
				aria-label="Open {placeholder} full size"
				onclick={() => onview?.(image!)}
			>
				<img src="/files/{image}" alt={placeholder} style:object-fit={fit} />
			</button>
		{:else}
			<a
				href="/files/{image}"
				target="_blank"
				rel="noopener"
				data-file-name={placeholder}
				aria-label="Open {placeholder} full size"
			>
				<img src="/files/{image}" alt={placeholder} style:object-fit={fit} />
			</a>
		{/if}
		<div class="slot-actions">
			<button
				type="button"
				class="slot-action"
				class:drag={dragOver}
				aria-label="Replace {placeholder}"
				onclick={() => input?.click()}
			>
				{busy && !confirming ? '…' : '↺'}
			</button>
			<button
				type="button"
				class="slot-action"
				class:confirming
				aria-label={confirming ? `Confirm removing ${placeholder}` : `Remove ${placeholder}`}
				onclick={remove}
				onblur={() => (confirming = false)}
			>
				{confirming ? 'Sure?' : '✕'}
			</button>
		</div>
	</div>
{:else}
	<div
		class="slot"
		class:drag={dragOver}
		role="button"
		tabindex="0"
		onclick={() => input?.click()}
		onkeydown={(e) => e.key === 'Enter' && input?.click()}
		ondragover={(e) => {
			e.preventDefault();
			dragOver = true;
		}}
		ondragleave={() => (dragOver = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragOver = false;
			const file = e.dataTransfer?.files?.[0];
			if (file) upload(file);
		}}
	>
		<span class="ph">{busy ? 'Uploading…' : placeholder}</span>
	</div>
{/if}
<input
	bind:this={input}
	type="file"
	accept="image/*"
	style="display: none"
	onchange={() => input?.files?.[0] && upload(input.files[0])}
/>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
	.slot {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		background: var(--card);
		overflow: hidden;
		position: relative;
	}
	.slot:not(.filled) {
		cursor: pointer;
	}
	.slot.drag {
		background: var(--card2);
	}
	a,
	.view {
		display: block;
		width: 100%;
		height: 100%;
	}
	.view {
		border: 0;
		background: transparent;
		padding: 0;
		cursor: zoom-in;
	}
	img {
		width: 100%;
		height: 100%;
		display: block;
	}
	.ph {
		font-size: var(--text-sm);
		color: var(--fg3);
		padding: 8px;
		text-align: center;
	}
	.error {
		margin: 5px 0 0;
		color: var(--red);
		font-size: var(--text-sm);
	}
	.slot-actions {
		position: absolute;
		top: 6px;
		right: 6px;
		display: flex;
		gap: var(--space-2);
	}
	.slot-action {
		min-width: 26px;
		height: 26px;
		border-radius: var(--radius-md);
		border: 1px solid var(--bd2);
		background: var(--plate);
		color: var(--fg1);
		font-size: var(--text-md);
		cursor: pointer;
		display: grid;
		place-items: center;
	}
	.slot-action.drag {
		border-color: var(--blue);
	}
	.slot-action:hover {
		background: var(--card3);
	}
	/* Armed, not done: red says the next tap deletes. */
	.slot-action.confirming {
		width: auto;
		padding: 0 8px;
		border-color: var(--red);
		color: var(--red);
		font-size: var(--text-xs);
	}
</style>
