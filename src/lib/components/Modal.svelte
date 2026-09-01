<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';
	import { overlayFocus } from '$lib/actions/overlay';

	let {
		title,
		onclose,
		children,
		titleAside
	}: {
		title: string;
		onclose: () => void;
		children: Snippet;
		/** Optional control beside the title — an ⓘ, a badge. Nothing by default,
		 *  so every existing dialog renders exactly as it did. */
		titleAside?: Snippet;
	} = $props();
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
			{#if titleAside}{@render titleAside()}{/if}
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
		/* Scrolling stops at this panel's own end. Without it the wheel is handed
		   on to whatever scrolls behind, so reaching the bottom here quietly
		   starts scrolling the page — and scrolling back moves the wrong one
		   first. See docs/ui-guidelines.md. */
		overscroll-behavior: contain;
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
		/* Scrolling stops at this panel's own end. Without it the wheel is handed
		   on to whatever scrolls behind, so reaching the bottom here quietly
		   starts scrolling the page — and scrolling back moves the wrong one
		   first. See docs/ui-guidelines.md. */
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	/* Pushes the close button to the far edge whether or not a titleAside is
	   rendered, so the two cases do not lay out differently. */
	.head :global(> :last-child) {
		margin-left: auto;
	}
	.title {
		font-size: var(--text-xl);
		font-weight: 600;
	}
	.close {
		border: 0;
		background: transparent;
		color: var(--fg3);
		font-size: var(--text-lg);
		cursor: pointer;
		padding: 4px;
	}
	.close:hover {
		color: var(--fg1);
	}
</style>
