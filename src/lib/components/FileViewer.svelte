<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// An uploaded file, shown over the screen that linked to it. X, Escape or a
	// click on the backdrop closes it and puts focus back on the link.
	//
	// Deliberately not the browser's tab: the row the file belongs to stays
	// visible behind it, and coming back is one key rather than a tab switch.
	import { overlayFocus } from '$lib/actions/overlay';
	import type { FileKind } from '$lib/ui/file-viewer';

	// The source is resolved by the caller, because the two link shapes answer
	// it differently: `/files/<name>` carries its extension, a document's file
	// is addressed by id and states its extension on the link.
	let {
		src,
		kind,
		download = '',
		title,
		onclose
	}: {
		src: string;
		kind: FileKind;
		download?: string;
		title: string;
		onclose: () => void;
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
		class="panel"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		use:overlayFocus={{ onclose }}
	>
		<div class="head">
			<span class="title">{title}</span>
			<!-- The two things the old new-tab behaviour was good for are kept as
			     buttons rather than lost: saving the file, and putting it on a
			     screen of its own beside the app. -->
			<a class="act" href={src} {download}>Download</a>
			<a class="act" href={src} target="_blank" rel="noopener">Open in tab</a>
			<button type="button" class="close" onclick={onclose} aria-label="Close">✕</button>
		</div>
		<div class="body" class:image={kind === 'image'}>
			{#if kind === 'image'}
				<img {src} alt={title} />
			{:else}
				<iframe {src} {title}></iframe>
			{/if}
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.72);
		display: grid;
		place-items: center;
		padding: 20px;
		z-index: 70;
	}
	.panel {
		/* --card is translucent by design; an overlay needs an opaque ground */
		background: linear-gradient(var(--card), var(--card)), var(--bg);
		border: 1px solid var(--bd2);
		border-radius: 14px;
		width: min(1100px, 100%);
		height: min(920px, calc(100vh - 40px));
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: 12px 14px 12px 18px;
		border-bottom: 1px solid var(--bd2);
	}
	.title {
		font-size: var(--text-lg);
		font-weight: 600;
		/* A long document name must not push the controls off the edge. */
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.act {
		flex: none;
		font-size: var(--text-sm);
		color: var(--fg3);
		text-decoration: none;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-5);
	}
	.act:hover {
		color: var(--fg1);
		border-color: var(--fg3);
	}
	.close {
		flex: none;
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
	.body {
		flex: 1;
		min-height: 0;
	}
	/* A PDF fills the panel; an image is centred on it, because a receipt
	   stretched to 1100px is a blurry receipt. */
	.body.image {
		display: grid;
		place-items: center;
		padding: 16px;
		overflow: auto;
	}
	iframe {
		width: 100%;
		height: 100%;
		border: 0;
		display: block;
	}
	img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
		border-radius: var(--radius-md);
	}
	@media (max-width: 640px) {
		.backdrop {
			padding: 0;
		}
		.panel {
			width: 100%;
			height: 100%;
			border: 0;
			border-radius: 0;
		}
		.head {
			padding: var(--space-5) var(--space-5) var(--space-5) var(--space-7);
			gap: var(--space-3);
		}
	}
</style>
