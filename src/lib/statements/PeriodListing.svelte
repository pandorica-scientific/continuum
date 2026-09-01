<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// What one period holds, listed under the band it was opened from.
	//
	// A cell with two documents in it cannot open "the" document, and splitting
	// the box into halves stops meaning anything at three — so a crowded period
	// opens this instead, and the list is where the choice is made.
	//
	// Below the band rather than floating over it: the cell that was pressed
	// stays visible, so it is clear which one is being explained.
	//
	// Its own component because two things now open it — the Statements ribbon
	// and the Income & Tax cards. Copied instead, the two would be one design
	// until the first time somebody improved one of them.
	interface ListedDocument {
		id: string;
		name: string;
		ext: string;
		typeLabel: string;
		addedOn: string;
	}

	let {
		title,
		subtitle,
		documents,
		onopen,
		onclose
	}: {
		/** The period — `Apr 2026`, `2025`. Set in mono: it is a figure. */
		title: string;
		/** Whose period it is: an account, a person, an employer. */
		subtitle: string;
		documents: ListedDocument[];
		onopen: (documentId: string) => void;
		onclose: () => void;
	} = $props();
</script>

<div class="listing">
	<div class="listing-head">
		<span class="mono period">{title}</span>
		<span class="listing-who">{subtitle}</span>
		<span class="listing-count">
			· {documents.length}
			{documents.length === 1 ? 'document' : 'documents'}
		</span>
		<!-- The same glyph the inspector's close uses; there is no close icon in
		     the set, and inventing one for a single button would leave two ways to
		     draw one gesture. -->
		<button type="button" class="listing-close" aria-label="Close the list" onclick={onclose}
			>✕</button
		>
	</div>
	{#each documents as doc (doc.id)}
		<button type="button" class="listing-row" onclick={() => onopen(doc.id)}>
			<span class="mono listing-ext">{doc.ext}</span>
			<span class="listing-name">
				<span class="listing-title">{doc.name}</span>
				<span class="listing-type">{doc.typeLabel}</span>
			</span>
			<span class="mono listing-date">{doc.addedOn}</span>
		</button>
	{/each}
</div>

<style>
	.listing {
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--bg2);
		overflow: hidden;
	}
	.listing-head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding: 10px 12px;
		border-bottom: 1px solid var(--bd);
	}
	.period {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.listing-who {
		font-size: var(--text-base);
		color: var(--fg2);
	}
	.listing-count {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.listing-close {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--fg3);
		cursor: pointer;
	}
	.listing-close:hover {
		color: var(--fg1);
	}
	.listing-row {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		width: 100%;
		padding: 10px 12px;
		border: 0;
		border-top: 1px solid var(--bd);
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.listing-row:first-of-type {
		border-top: 0;
	}
	.listing-row:hover {
		background: var(--card2);
	}
	.listing-ext {
		font-size: var(--text-xs);
		color: var(--fg3);
		min-width: 4ch;
	}
	.listing-name {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.listing-title {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.listing-type {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.listing-date {
		margin-left: auto;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
