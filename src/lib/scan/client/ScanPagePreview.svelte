<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Three answers and a way to the editor.
	//
	// This screen used to argue that corner handles should not exist — dragging
	// four of them on a phone being worse than taking the photo again, with
	// `original` as the recovery. That held until the detector met a card too
	// small in frame, an object with a dark band across it, and a page the same
	// brightness as the table: failures no retake fixes, where `original` hands
	// back the desk along with the page. So the crop is still visible before it
	// is kept, Replace still costs one tap, and the edges are now correctable
	// rather than merely refusable.

	import Icon from '$lib/components/Icon.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import type { PageMode, PageSource } from '../core/index.ts';

	let {
		previewUrl,
		mode,
		source,
		busy = false,
		/**
		 * A picture rather than a document: one page, and nothing after this
		 * screen. It changes two words. Everything else — the four modes, the
		 * rotate, the corner editor and its Whole photo — is the same screen doing
		 * the same job, which is the point of reusing it.
		 */
		picture = false,
		onkeep,
		onreplace,
		onmode,
		onrotate,
		onedges
	}: {
		previewUrl: string;
		mode: PageMode;
		source: PageSource;
		busy?: boolean;
		picture?: boolean;
		onkeep: () => void;
		onreplace: () => void;
		onmode: (mode: PageMode) => void;
		onrotate: () => void;
		/** Open the corner editor: the floor under a detector that got it wrong. */
		onedges: () => void;
	} = $props();

	/**
	 * B&W first and default: household paper is text on white, it reads best and
	 * the file is smallest. Colour is the exception for a stamp or a signature,
	 * so it comes late. Original is last — it is a recovery, not a look.
	 */
	const MODES = [
		{ value: 'bw', label: 'B&W' },
		{ value: 'grayscale', label: 'Grayscale' },
		{ value: 'color', label: 'Colour' },
		{ value: 'original', label: 'Original' }
	];

	/**
	 * Same slot, same weight, different verb. On the upload path there is no
	 * viewfinder to go back to — the file came from the gallery — so "Replace"
	 * would promise something that does not exist.
	 */
	const replaceLabel = $derived(source === 'upload' ? 'Choose another file' : 'Replace');
</script>

<div class="preview">
	<div class="paper">
		<img
			src={previewUrl}
			alt={picture ? 'The picture as it will be saved' : 'The page as it will be saved'}
		/>
		{#if busy}
			<!-- Tapping a mode re-processes, so the tap lands at once and the PAGE
			     catches up under a scrim naming what it is doing. -->
			<p class="working">Cleaning up this page</p>
		{/if}
	</div>

	<div class="deck">
		<div class="modes">
			<Segmented options={MODES} value={mode} onchange={(value) => onmode(value as PageMode)} />
		</div>
		<!-- Fixed height, so the deck does not jump as the wording changes. -->
		<!-- The line someone reads at exactly the moment the crop is wrong, so the
		     way to fix it belongs here rather than behind an icon in the deck. -->
		<p class="note">
			{mode === 'original' ? 'Cropped, with the colours exactly as photographed.' : 'Crop wrong?'}
			<button type="button" class="edges" onclick={onedges}>Adjust the edges</button>
		</p>

		<div class="actions">
			<button type="button" class="btn btn-primary" onclick={onkeep} disabled={busy}
				>{picture ? 'Use this' : 'Keep page'}</button
			>
			<button type="button" class="btn" onclick={onreplace}>{replaceLabel}</button>
			<button type="button" class="btn rotate" aria-label="Rotate this page" onclick={onrotate}>
				<Icon name="rotate" size={19} />
			</button>
		</div>
	</div>
</div>

<style>
	.edges {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--blue);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.edges:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 3px;
		border-radius: var(--radius-xs);
	}

	.preview {
		position: fixed;
		inset: 0;
		/* Not `inset: 0` alone.
		 *
		 * On iOS Safari a fixed element sized that way resolves against the LARGE
		 * viewport — the full height including the strip behind the collapsing
		 * browser chrome — so the panel ends up taller than the part you can see
		 * and the page scrolls to make up the difference. `100dvh` follows the
		 * visible area as the chrome expands and contracts; `100vh` is the
		 * fallback for anything that predates it, and is what `inset: 0` would
		 * have given anyway. */
		height: 100vh;
		height: 100dvh;
		z-index: 41;
		display: grid;
		grid-template-rows: 1fr auto;
		gap: var(--space-5);
		padding: var(--space-6);
		padding-top: calc(var(--safe-top) + var(--space-6));
		padding-bottom: calc(var(--safe-bottom) + var(--space-6));
		background: var(--bg);
		color: var(--fg1);
		overflow: hidden;
		/* A drag on a scan screen is not a scroll. Without this the browser
		   still tries to pan, which on iOS shows as the whole panel rubber-banding
		   away from the top of the screen. */
		touch-action: none;
		overscroll-behavior: none;
	}
	.paper {
		position: relative;
		display: grid;
		place-items: center;
		min-height: 0;
		border-radius: var(--radius-xl);
		background: var(--card);
		overflow: hidden;
	}
	/* Absolutely positioned, not merely capped.
	 *
	 * `max-height: 100%` resolves against the grid track, and a `1fr` track has
	 * no definite height to resolve against — so a tall photograph ignored the
	 * cap and ran off the bottom, showing only part of the page the user is
	 * being asked to approve. Filling an absolutely positioned box and letting
	 * `object-fit: contain` do the work has no such ambiguity. */
	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.working {
		position: absolute;
		inset: 0;
		margin: 0;
		display: grid;
		place-items: center;
		background: var(--scan-plate);
		color: var(--scan-ink);
	}
	/* Four segments at 360px with a 44px floor is tight, so they wrap rather
	   than truncate: "Grayscale" cut to "Gray" reads as a different product. */
	.modes :global(.segmented) {
		flex-wrap: wrap;
	}
	.modes :global(.segmented button) {
		flex: 1 1 84px;
		min-height: var(--touch-min);
	}
	.deck {
		display: grid;
		gap: var(--space-5);
		align-content: end;
		min-width: 0;
	}
	/* Landscape on a PHONE, not on a desktop: the height bound is what
	   distinguishes them. Stacked, the fixed-height controls would eat most of a
	   390px viewport and leave the page — the thing being judged — a sliver.
	   Beside it, the page keeps the full height. */
	@media (orientation: landscape) and (max-height: 620px) {
		.preview {
			grid-template-columns: 1fr minmax(240px, 32%);
			grid-template-rows: 1fr;
		}
		.modes :global(.segmented button) {
			flex: 1 1 100%;
		}
	}
	.note {
		margin: 0;
		min-height: 20px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr auto;
		gap: var(--space-4);
	}
	.actions :global(.btn) {
		min-height: var(--touch-min);
	}
	.actions :global(.btn):focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
</style>
