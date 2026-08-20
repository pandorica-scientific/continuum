<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// Full-size image viewer: X, Escape, or a click outside the image closes it.
	import { overlayFocus } from '$lib/actions/overlay';
	let { image, alt, onclose }: { image: string; alt: string; onclose: () => void } = $props();
</script>

<div
	class="backdrop"
	role="dialog"
	aria-modal="true"
	aria-label={alt}
	tabindex="-1"
	use:overlayFocus={{ onclose }}
	onkeydown={() => {}}
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
		font-size: var(--text-xl);
		cursor: pointer;
		display: grid;
		place-items: center;
	}
	.close:hover {
		color: var(--red);
	}
</style>
