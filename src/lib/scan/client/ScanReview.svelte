<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import Icon from '$lib/components/Icon.svelte';
	import { MAX_PAGES, type ScanPage } from './session.svelte.ts';

	let {
		pages,
		filename,
		busy = false,
		onmove,
		onremove,
		onrename,
		onadd,
		onmake,
		oncancel
	}: {
		pages: ScanPage[];
		filename: string;
		busy?: boolean;
		onmove: (id: string, direction: -1 | 1) => void;
		onremove: (id: string) => void;
		onrename: (name: string) => void;
		onadd: () => void;
		onmake: () => void;
		oncancel: () => void;
	} = $props();
</script>

<div class="review">
	{#if pages.length === 0}
		<div class="empty">
			<h2>No pages yet</h2>
			<button type="button" class="btn btn-primary" onclick={onadd}>Take a photo</button>
			<button type="button" class="btn" onclick={oncancel}>Cancel</button>
		</div>
	{:else}
		<header>
			<h2>{pages.length} {pages.length === 1 ? 'page' : 'pages'}</h2>
			<!-- Name the state for the FILE, not the page count: "page 3 of 5"
			     reads as five separate uploads of five separate things. -->
			<p class="sub">They will be combined into one PDF.</p>
		</header>

		<ul class="grid">
			{#each pages as page, index (page.id)}
				<li class="tile">
					<span class="badge"><Icon name="grip" size={15} /> {index + 1}</span>
					<!-- Every tile is the same 3:4 box and the page sits INSIDE it at
					     its own ratio, so a landscape page cannot make its row taller
					     than the row beside it. -->
					<div class="box"><img src={page.previewUrl} alt="Page {index + 1}" /></div>
					{#if !busy}
						<div class="reorder">
							<button
								type="button"
								class="step"
								aria-label="Move page {index + 1} up"
								aria-disabled={index === 0}
								onclick={() => index > 0 && onmove(page.id, -1)}
							>
								<Icon name="arrowUp" size={17} />
							</button>
							<button
								type="button"
								class="step"
								aria-label="Move page {index + 1} down"
								aria-disabled={index === pages.length - 1}
								onclick={() => index < pages.length - 1 && onmove(page.id, 1)}
							>
								<Icon name="arrowDown" size={17} />
							</button>
							<button
								type="button"
								class="step"
								aria-label="Remove page {index + 1}"
								onclick={() => onremove(page.id)}>✕</button
							>
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		<div class="deck">
			<!-- The review screen is the only moment the user knows what the
			     document is, so it is the only place worth asking for its name. -->
			<label class="save">
				<span>Save as</span>
				<input
					value={filename}
					disabled={busy}
					onchange={(event) => onrename(event.currentTarget.value)}
				/>
			</label>

			{#if pages.length >= MAX_PAGES}
				<p class="note">
					Twenty pages is the most one scan holds. Make this PDF, then start another.
				</p>
			{/if}

			<div class="actions">
				<button type="button" class="btn btn-primary" onclick={onmake} disabled={busy}>
					{busy ? 'Combining into one PDF' : 'Make the PDF'}
				</button>
				<button
					type="button"
					class="btn"
					onclick={onadd}
					disabled={busy || pages.length >= MAX_PAGES}
				>
					Add a page
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.review {
		position: fixed;
		inset: 0;
		height: 100vh;
		height: 100dvh;
		z-index: 41;
		display: grid;
		grid-template-rows: auto 1fr auto;
		gap: var(--space-5);
		padding: var(--space-6);
		padding-top: calc(var(--safe-top) + var(--space-6));
		padding-bottom: calc(var(--safe-bottom) + var(--space-6));
		background: var(--bg);
		color: var(--fg1);
		overflow: hidden;
		overscroll-behavior: none;
	}
	header {
		display: grid;
		gap: var(--space-2);
	}
	h2 {
		margin: 0;
		font-size: var(--text-2xl);
	}
	.sub {
		margin: 0;
		color: var(--fg3);
	}
	.empty {
		display: grid;
		gap: var(--space-5);
		justify-items: center;
		align-content: center;
	}
	.empty :global(.btn) {
		min-height: var(--touch-min);
		min-width: 12rem;
	}
	/* Never reflow to a single column on a narrow screen: that recreates the
	   scrolling list this screen exists to replace. */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
		gap: var(--space-6);
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		align-content: start;
		min-height: 0;
	}
	.tile {
		display: grid;
		gap: var(--space-3);
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.box {
		display: grid;
		place-items: center;
		aspect-ratio: 3 / 4;
		border: 1px solid var(--bd);
		border-radius: var(--radius-md);
		background: var(--card);
		overflow: hidden;
	}
	img {
		max-width: 92%;
		max-height: 92%;
	}
	.reorder {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-2);
	}
	.step {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--touch-min);
		border: 1px solid var(--bd);
		border-radius: var(--radius-sm);
		background: var(--card);
		color: var(--fg2);
		font: inherit;
		cursor: pointer;
	}
	/* Dimmed, not removed: a control that vanishes shifts the two beside it, so
	   they stop landing where the eye left them. */
	.step[aria-disabled='true'] {
		color: var(--bd2);
		cursor: not-allowed;
	}
	.deck {
		display: grid;
		gap: var(--space-4);
	}
	.save {
		display: grid;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.save input {
		min-height: var(--touch-min);
	}
	.note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-4);
	}
	.actions :global(.btn) {
		min-height: var(--touch-min);
	}
	.step:focus-visible,
	.save input:focus-visible,
	.actions :global(.btn):focus-visible,
	.empty :global(.btn):focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
</style>
