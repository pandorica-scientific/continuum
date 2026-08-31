<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// The receipts dialog for one transaction — split out of the register's own
	// `+page.svelte` so its states (an attach-candidates fetch that can fail, a
	// load in progress) render from plain props and are testable the way
	// `DocumentsCard` is, rather than living as `$state` a route component can
	// only ever show one value of at a time.
	//
	// The fetch itself stays in the page: it is tied to which row is open
	// there, not to anything this dialog draws.
	import { enhance } from '$app/forms';
	import DocumentsCard from '$lib/components/DocumentsCard.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import type { AboutDocument, CandidateDocument } from '$lib/server/documents/targets';

	let {
		transaction,
		candidates,
		candidatesError,
		loadingCandidates,
		formMessage,
		isAdmin = false,
		onclose
	}: {
		transaction: { id: string; merchant: string; amount: string; documents: AboutDocument[] };
		/** From `?/candidates`, for this transaction only — see the page for why. */
		candidates: CandidateDocument[];
		/** Set when the `?/candidates` fetch failed or came back anything but a
		 *  success — a network error and a CSRF refusal page both land here,
		 *  since a person cannot tell those apart and does not need to. */
		candidatesError: string | null;
		/** True while that fetch is in flight, so the picker says it is checking
		 *  rather than the list quietly popping in a moment later. */
		loadingCandidates: boolean;
		/** A failure from `attachDocument`/`detachDocument` that named this row. */
		formMessage: string | null;
		isAdmin?: boolean;
		onclose: () => void;
	} = $props();
</script>

<Modal title="Receipts" {onclose}>
	<p class="modal-sub">{transaction.merchant} · {transaction.amount}</p>

	{#if formMessage}
		<p class="row-error" role="alert">{formMessage}</p>
	{/if}

	<!-- `bare`: the Modal already draws the bordered, padded box this dialog
	     sits in, so the card's own `.card` here would double both. -->
	<DocumentsCard
		bare
		heading="Receipts"
		documents={transaction.documents}
		target={{ id: transaction.id, kind: 'transaction', label: transaction.merchant }}
		emptyText="Nothing filed against this row yet."
		attach={{ action: 'attachDocument', candidates }}
		detachAction="detachDocument"
		confirmDetach
		{isAdmin}
	/>

	{#if candidatesError}
		<p class="row-error" role="alert">{candidatesError}</p>
	{:else if loadingCandidates}
		<p class="modal-sub">Checking what you could attach…</p>
	{/if}

	<form
		method="POST"
		action="?/attachDocument"
		enctype="multipart/form-data"
		use:enhance
		class="attach-form"
	>
		<input type="hidden" name="targetId" value={transaction.id} />
		<div class="attach-zone">
			<UploadDropzone
				name="file"
				accept="application/pdf,image/*"
				idleText="Drop a receipt here, or click to browse"
				description="PDF, PNG or JPEG"
			/>
		</div>
		<button type="submit" class="btn btn-primary">Attach</button>
	</form>
</Modal>

<style>
	.modal-sub {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.attach-form {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		min-width: 0;
	}
	/* A file input's default width is far wider than its box and does not shrink,
	   which pushed the whole register into horizontal scroll at phone width. */
	.attach-zone {
		max-width: 100%;
		min-width: 0;
		flex: 1 1 12rem;
	}
	.row-error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--red);
	}
</style>
