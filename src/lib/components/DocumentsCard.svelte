<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// The paper filed against one record, shared by every screen that has records.
	//
	// It renders what it is handed and posts what it is asked to. The archive
	// scope is not here and must not be: `documentsAbout` applies it in SQL.
	import { enhance } from '$app/forms';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import {
		documentExpiryTone,
		expiryTreatment,
		SOON_DAYS,
		type ExpiryTone
	} from '$lib/documents/view';
	import { documentFileHref } from '$lib/ui/file-viewer';
	// Type only — erased at compile time, so the server module is never pulled
	// into the browser bundle.
	import type {
		AboutDocument,
		CandidateDocument,
		DocumentTargetKind
	} from '$lib/server/documents/targets';

	let {
		documents,
		target,
		emptyText,
		addHref,
		addLabel = 'Add a document',
		attach,
		detachAction,
		confirmDetach = false,
		heading = 'Documents',
		bare = false
	}: {
		/** From `documentsAbout(target.id)` — already filtered by the read rule. */
		documents: AboutDocument[];
		/** The record this card belongs to. `label` is what the person calls it. */
		target: { id: string; kind: DocumentTargetKind; label: string };
		/** What the card says when nothing is filed — name the paper that belongs here. */
		emptyText: string;
		/** Capture prefill: `/documents?add=1&addShelfKey=…&targetKind=…&targetId=…`. */
		addHref?: string;
		addLabel?: string;
		/** From `candidateDocuments(target.id)`; the picker hides when empty. */
		attach?: { action: string; candidates: CandidateDocument[] };
		detachAction?: string;
		/**
		 * Ask twice before posting `detachAction`. Everywhere else, detaching
		 * only removes the link and the document stays on its shelf, so one tap
		 * is enough — but Transactions' `detachDocument` deletes the document,
		 * which a mis-click can't undo, so its card asks for a second tap.
		 */
		confirmDetach?: boolean;
		heading?: string;
		/**
		 * Drop the `.card` wrapper and its padding, for a screen where this card
		 * lands inside an existing card — the host supplies both instead.
		 */
		bare?: boolean;
	} = $props();

	// The clock the hues are read against.
	const today = new Date().toISOString().slice(0, 10);

	// Which row's delete is armed, when `confirmDetach` asks for one. Cleared
	// whenever the filed list changes, so a stale button can't stay armed for
	// a row that's no longer under the pointer.
	let armed = $state<string | null>(null);
	$effect(() => {
		void documents;
		armed = null;
	});

	/** One line, three states — see `documentExpiryTone` for why only three. */
	const TONE: Record<ExpiryTone, string> = {
		expired: 'var(--red)',
		soon: 'var(--yellow)',
		quiet: 'var(--fg3)'
	};

	/**
	 * What the second line says after the shelf: when it falls due, or when it
	 * arrived. Same phrasing as the Documents screen.
	 */
	function metaOf(d: AboutDocument): string {
		return expiryTreatment(d, false, today, 'wide', d.reminderDays ?? SOON_DAYS)?.text ?? '';
	}
</script>

<div class={bare ? 'stack' : 'card stack'}>
	<Eyebrow hue="--fg3" icon="folders" label={heading}>
		{#snippet right()}
			<!-- Entity filter, not `?q=<name>`: a name search matches a different,
			     broader set than documents actually filed against this record. -->
			<a class="eyebrow-caption" href="/documents?entity={encodeURIComponent(target.id)}">
				Open in Documents →
			</a>
		{/snippet}
	</Eyebrow>

	{#each documents as d (d.id)}
		<div class="doc">
			<span class="mono ext">{d.ext}</span>
			<div class="doc-names">
				<span class="doc-name">
					{#if d.storedName}
						<!-- Through the document, never `/files/<stored name>`: a stored
						     name alone can't say which document it belongs to. -->
						<a
							class="name-text"
							href={documentFileHref(d.id)}
							target="_blank"
							rel="noopener"
							data-file-ext={d.ext}>{d.name}</a
						>
					{:else}
						<span class="name-text">{d.name}</span>
					{/if}
				</span>
				<span
					class="doc-meta"
					style:color={TONE[documentExpiryTone(d, today, d.reminderDays ?? SOON_DAYS)]}
				>
					{d.shelfLabel} · {metaOf(d)}
				</span>
			</div>
			{#if detachAction && confirmDetach && armed === d.id}
				<!-- The second tap: actually deletes. -->
				<form method="POST" action="?/{detachAction}" use:enhance class="detach">
					<input type="hidden" name="targetId" value={target.id} />
					<input type="hidden" name="documentId" value={d.id} />
					<button type="submit" class="unlink confirm">Delete?</button>
				</form>
			{:else if detachAction && confirmDetach}
				<!-- First tap arms the row rather than posting, since this card's
				     detach deletes the document (see `confirmDetach` above). -->
				<button
					type="button"
					class="unlink"
					aria-label="Delete {d.name} from {target.label}"
					onclick={() => (armed = d.id)}
				>
					✕
				</button>
			{:else if detachAction}
				<!-- No confirm step: detaching only removes the link, the document
				     stays on its shelf. -->
				<form method="POST" action="?/{detachAction}" use:enhance class="detach">
					<input type="hidden" name="targetId" value={target.id} />
					<input type="hidden" name="documentId" value={d.id} />
					<button type="submit" class="unlink" aria-label="Unfile {d.name} from {target.label}"
						>✕</button
					>
				</form>
			{/if}
		</div>
	{:else}
		<span class="quiet">{emptyText}</span>
	{/each}

	{#if attach && attach.candidates.length > 0}
		<!-- Only shown when there's something to attach. -->
		<form method="POST" action="?/{attach.action}" use:enhance class="attach">
			<input type="hidden" name="targetId" value={target.id} />
			<!-- Empty first option, so Attach can't silently file whatever sorts first. -->
			<select name="documentId" required aria-label="Attach an existing document">
				<option value="">Attach a document you already have…</option>
				{#each attach.candidates as c (c.id)}
					<option value={c.id}>{c.name} · {c.shelfLabel}</option>
				{/each}
			</select>
			<button type="submit" class="btn">Attach</button>
		</form>
	{/if}

	{#if addHref}
		<a href={addHref} class="btn add">➕ {addLabel}</a>
	{/if}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.quiet {
		line-height: 1.55;
	}
	/* Badge column is fixed width; the last column collapses when there's no
	   detach control. */
	.doc {
		display: grid;
		grid-template-columns: 38px minmax(0, 1fr) auto;
		gap: 11px;
		align-items: center;
		padding: 4px 0;
	}
	.ext {
		font-size: var(--text-2xs);
		letter-spacing: 0.04em;
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: 5px;
		padding: 4px 0;
		text-align: center;
	}
	.doc-names {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.doc-name {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
	}
	.name-text {
		font-size: var(--text-md);
		color: var(--fg1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.doc-meta {
		font-size: var(--text-xs);
	}
	.detach {
		display: flex;
	}
	/* Quiet until reached for: unfiling is a correction, not an offered action. */
	.unlink {
		background: none;
		border: none;
		padding: 0 var(--space-3);
		color: var(--fg3);
		font-size: var(--text-sm);
		line-height: 1;
		cursor: pointer;
	}
	.unlink:hover {
		color: var(--fg1);
	}
	/* The second tap of a `confirmDetach` card: loud, since it can't be undone. */
	.unlink.confirm {
		color: var(--red);
	}
	.attach {
		display: flex;
		gap: var(--space-4);
		/* Wraps rather than squeezing the select down on a phone. */
		flex-wrap: wrap;
		align-items: center;
	}
	.attach select {
		flex: 1 1 180px;
		min-width: 0;
	}
	.add {
		align-self: flex-start;
	}
</style>
