<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Putting the confirmation on a booking.
	 *
	 * Through `UploadDropzone` rather than a bare file input, which is the
	 * product's rule for anything that is PAPER: drag, click and the phone
	 * camera are offered in one place instead of at whichever site somebody
	 * remembered to update. A boarding pass somebody has on the table is
	 * exactly the case the camera is for.
	 *
	 * A dialog rather than a control on the row: the timeline is a line of five
	 * bookings, and a dropzone in each would make it a page of dropzones.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';

	let {
		booking,
		message = null,
		onclose
	}: {
		booking: { id: string; title: string };
		message?: string | null;
		onclose: () => void;
	} = $props();
</script>

<Modal title="Attach the confirmation" {onclose}>
	<form class="body" method="POST" action="?/attachBooking" enctype="multipart/form-data">
		<input type="hidden" name="id" value={booking.id} />

		<p class="what">
			For <strong>{booking.title}</strong>. It is filed in the archive and linked to this trip, so
			it turns up in a search like every other piece of paper.
		</p>

		<ActionError {message} />

		<UploadDropzone
			name="file"
			accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
			idleText="Drop the confirmation, or take a photograph of it"
			description="PDF, JPEG, PNG, WebP or HEIC"
			reportErrors={false}
		/>

		<div class="actions">
			<button class="btn" type="button" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" type="submit">Attach it</button>
		</div>
	</form>
</Modal>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.what {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
		max-width: 60ch;
	}
	strong {
		color: var(--fg1);
		font-weight: 600;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}
</style>
