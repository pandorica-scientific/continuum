<script lang="ts">
	import { invalidateAll } from '$app/navigation';

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
	let dragOver = $state(false);
	let busy = $state(false);

	async function upload(file: File) {
		const body = new FormData();
		body.set('propertyId', propertyId);
		body.set('slot', slot);
		body.set('file', file);
		busy = true;
		try {
			await fetch('/property?/uploadImage', { method: 'POST', body });
			await invalidateAll();
		} finally {
			busy = false;
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
				aria-label="Open {placeholder} full size"
			>
				<img src="/files/{image}" alt={placeholder} style:object-fit={fit} />
			</a>
		{/if}
		<button
			type="button"
			class="replace"
			class:drag={dragOver}
			aria-label="Replace {placeholder}"
			onclick={() => input?.click()}
		>
			{busy ? '…' : '↺'}
		</button>
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
		font-size: 12.5px;
		color: var(--fg3);
		padding: 8px;
		text-align: center;
	}
	.replace {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 26px;
		height: 26px;
		border-radius: 8px;
		border: 1px solid var(--bd2);
		background: var(--plate);
		color: var(--fg1);
		font-size: 13px;
		cursor: pointer;
		display: grid;
		place-items: center;
	}
	.replace.drag {
		border-color: var(--blue);
	}
</style>
