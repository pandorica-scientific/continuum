<script lang="ts">
	// Full-size image viewer: X, Escape, or a click outside the image closes it.
	let { image, alt, onclose }: { image: string; alt: string; onclose: () => void } = $props();

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<div
	class="backdrop"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onclose();
	}}
>
	<img src="/files/{image}" {alt} />
	<button type="button" class="close" onclick={onclose} aria-label="Close">✕</button>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.82);
		display: grid;
		place-items: center;
		padding: 28px;
		z-index: 70;
	}
	img {
		max-width: 100%;
		max-height: calc(100vh - 56px);
		object-fit: contain;
		border-radius: 8px;
	}
	.close {
		position: fixed;
		top: 14px;
		right: 16px;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		border: 1px solid var(--bd2);
		background: var(--bg);
		color: var(--fg1);
		font-size: 15px;
		cursor: pointer;
		display: grid;
		place-items: center;
	}
	.close:hover {
		color: var(--red);
	}
</style>
