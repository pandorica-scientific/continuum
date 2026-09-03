<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// The paper filed against one record, on every screen that has records.
	//
	// Before this, five screens each drew their own version of the same card and
	// each knew a different amount: the property card coloured any expiry amber,
	// the transactions one deleted the document when you unlinked it, and three
	// more listed nothing at all. A card is not where those decisions belong, so
	// this is the only one — the property card's markup, which was the best of
	// them, with the rules it was missing.
	//
	// It renders what it is handed and posts what it is asked to. The read rule
	// is not here and must not be: `documentsAbout` applies it in SQL, so a row
	// this card never receives is a row no member can learn exists. `isAdmin`
	// only draws the lock; it hides nothing.
	import { enhance } from '$app/forms';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import {
		documentExpiryTone,
		expiryTreatment,
		SOON_DAYS,
		type ExpiryTone
	} from '$lib/documents/view';
	import { documentFileHref } from '$lib/ui/file-viewer';
	// Type only — erased at compile time, so the server module is never pulled
	// into the browser bundle. The shape of a filed document is defined once,
	// beside the query that produces it.
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
		isAdmin = false,
		heading = 'Documents',
		bare = false
	}: {
		/** From `documentsAbout(target.id, actor)` — already filtered by the read rule. */
		documents: AboutDocument[];
		/** The record this card belongs to. `label` is what the person calls it. */
		target: { id: string; kind: DocumentTargetKind; label: string };
		/** What the card says when nothing is filed — name the paper that belongs here. */
		emptyText: string;
		/** Capture prefill: `/documents?add=1&addShelfKey=…&targetKind=…&targetId=…`. */
		addHref?: string;
		addLabel?: string;
		/** From `candidateDocuments(target.id, actor)`; the picker hides when empty. */
		attach?: { action: string; candidates: CandidateDocument[] };
		detachAction?: string;
		/**
		 * Ask twice before posting `detachAction`, for the one screen whose
		 * detach does not merely unlink.
		 *
		 * Everywhere else, detaching removes the LINK: the document stays on its
		 * shelf, so a mis-click costs a re-attach rather than evidence, and one
		 * tap is enough. Transactions' `detachDocument` deletes the document
		 * (Task 9) — a mis-click there cannot be undone by re-attaching, so its
		 * card asks for a second tap first.
		 */
		confirmDetach?: boolean;
		/** Draws the lock on restricted rows. Never what decides which rows exist. */
		isAdmin?: boolean;
		heading?: string;
		/**
		 * Drop the `.card` wrapper and its padding, for a screen where this card
		 * lands inside an existing card (the contacts edit panel, an account row)
		 * — a card nested inside a card doubles the border and padding rather
		 * than reading as one record. The host supplies both instead.
		 */
		bare?: boolean;
	} = $props();

	// The clock the hues are read against. Taken once per render rather than
	// passed in: a card colours a date relative to the day the person is
	// looking at it, and every other component that needs today does the same.
	const today = new Date().toISOString().slice(0, 10);

	// Which row's delete is armed, when `confirmDetach` asks for one. Cleared
	// whenever the filed list changes — a save that adds or removes a document
	// must not leave a stale button armed for a row that is no longer the one
	// under the pointer.
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
	 * arrived. The same phrasing the Documents screen uses, so a document reads
	 * the same on the card it is filed against and in the files.
	 */
	function metaOf(d: AboutDocument): string {
		// The window rides on the row, because a card draws many types at once and
		// a passport's six months must not become a receipt's.
		return expiryTreatment(d, false, today, 'wide', d.reminderDays ?? SOON_DAYS)?.text ?? '';
	}
</script>

<div class={bare ? 'stack' : 'card stack'}>
	<Eyebrow hue="--fg3" emoji="🗂️" label={heading}>
		{#snippet right()}
			<!-- The entity filter, not `?q=<name>`: a name round-trip matches every
			     document whose name contains the string, which is a different set
			     from the documents filed against this record. -->
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
						     name cannot say which document it belongs to. `data-file-ext`
						     is how the overlay knows what it is about to show. -->
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
					{#if isAdmin && d.sensitivity === 'restricted'}
						<!-- Quiet, and admins only: restricted is an access state, not a
						     warning. A member never sees the row to begin with. -->
						<span class="lock"><Icon name="lock" size={13} label="Restricted" /></span>
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
				<!-- The second tap. Only reached once armed below, and only for the
				     row that was armed — this is the one that actually deletes. -->
				<form method="POST" action="?/{detachAction}" use:enhance class="detach">
					<input type="hidden" name="targetId" value={target.id} />
					<input type="hidden" name="documentId" value={d.id} />
					<button type="submit" class="unlink confirm">Delete?</button>
				</form>
			{:else if detachAction && confirmDetach}
				<!-- The first tap arms the row rather than posting: this card's detach
				     deletes the document (see `confirmDetach` above), and a mis-click
				     here cannot be undone the way an ordinary unlink can. -->
				<button
					type="button"
					class="unlink"
					aria-label="Delete {d.name} from {target.label}"
					onclick={() => (armed = d.id)}
				>
					✕
				</button>
			{:else if detachAction}
				<!-- No confirm step. Detaching removes the LINK; the document stays on
				     its shelf and is one click away in Documents, so a mis-click costs
				     a re-attach rather than evidence. -->
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
		<!-- Only when there is something to attach: an empty picker on every card
		     in the app is a control that answers a question nobody asked. -->
		<form method="POST" action="?/{attach.action}" use:enhance class="attach">
			<input type="hidden" name="targetId" value={target.id} />
			<!-- An empty first option, so Attach cannot silently file whichever
			     document happened to sort first. -->
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
	/* The badge column is fixed so a card of mixed formats reads as a column;
	   the last one collapses to nothing on a card with no detach control. */
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
	.lock {
		flex: none;
		color: var(--fg3);
		display: inline-flex;
	}
	.doc-meta {
		font-size: var(--text-xs);
	}
	.detach {
		display: flex;
	}
	/* Quiet until reached for: unfiling is a correction, not an action the card
	   is offering. It takes the row's height so the grid stays on one line. */
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
	/* The second tap of a `confirmDetach` card: loud, because what it does
	   cannot be undone by re-attaching the way an ordinary unlink can. */
	.unlink.confirm {
		color: var(--red);
	}
	.attach {
		display: flex;
		gap: var(--space-4);
		/* Wraps rather than squeezing the select to nothing on a phone. */
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
