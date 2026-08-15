<script lang="ts">
	import type { Snippet } from 'svelte';
	import { overlayFocus } from '$lib/actions/overlay';

	let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } =
		$props();
</script>

<div
	class="backdrop"
	role="presentation"
	onclick={(e) => {
		if (e.target === e.currentTarget) onclose();
	}}
>
	<div
		class="modal"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		use:overlayFocus={{ onclose }}
	>
		<div class="head">
			<span class="title">{title}</span>
			<button type="button" class="close" onclick={onclose} aria-label="Close">✕</button>
		</div>
		{@render children()}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.55);
		display: grid;
		place-items: center;
		padding: 20px;
		z-index: 60;
		overflow-y: auto;
	}
	.modal {
		/* --card is translucent by design; a dialog needs an opaque ground */
		background: linear-gradient(var(--card), var(--card)), var(--bg);
		border: 1px solid var(--bd2);
		border-radius: 14px;
		padding: 18px 20px;
		width: min(860px, 100%);
		max-height: calc(100vh - 40px);
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.title {
		font-size: 15px;
		font-weight: 600;
	}
	.close {
		border: 0;
		background: transparent;
		color: var(--fg3);
		font-size: 14px;
		cursor: pointer;
		padding: 4px;
	}
	.close:hover {
		color: var(--fg1);
	}
</style>
