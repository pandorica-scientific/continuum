<script lang="ts">
	import { invalidateAll } from '$app/navigation';

	let {
		propertyId,
		slot,
		image,
		placeholder,
		fit = 'cover'
	}: {
		propertyId: string;
		slot: string;
		image: string | undefined;
		placeholder: string;
		fit?: 'cover' | 'contain';
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
	{#if image}
		<img src="/files/{image}" alt={placeholder} style:object-fit={fit} />
	{:else}
		<span class="ph">{busy ? 'Uploading…' : placeholder}</span>
	{/if}
	<input
		bind:this={input}
		type="file"
		accept="image/*"
		style="display: none"
		onchange={() => input?.files?.[0] && upload(input.files[0])}
	/>
</div>

<style>
	.slot {
		width: 100%;
		height: 100%;
		display: grid;
		place-items: center;
		background: var(--card);
		cursor: pointer;
		overflow: hidden;
	}
	.slot.drag {
		background: var(--card2);
	}
	img {
		width: 100%;
		height: 100%;
	}
	.ph {
		font-size: 12.5px;
		color: var(--fg3);
		padding: 8px;
		text-align: center;
	}
</style>
