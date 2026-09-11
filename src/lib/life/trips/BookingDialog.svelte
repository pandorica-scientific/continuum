<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Adding a flight, a room, a train.
	 *
	 * The day and the time are two fields because that is how a confirmation
	 * reads them out — "5 October, 09:00" — and asking for one combined field
	 * makes somebody translate before they can type.
	 *
	 * "Until" only appears for something you sleep in. A flight has no last
	 * night, and a field that is meaningless for five of the seven kinds is a
	 * field five out of seven people have to decide to ignore.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import type { EnumValue } from '$lib/enums';

	type Kind = EnumValue<'booking.kind'>;

	let {
		kinds,
		/** The trip's own dates, so the day field opens on the right month. */
		startsOn,
		endsOn,
		message = null,
		onclose
	}: {
		kinds: readonly Kind[];
		startsOn: string;
		endsOn: string;
		message?: string | null;
		onclose: () => void;
	} = $props();

	let kind = $state<Kind>('flight');
	const isStay = $derived(kind === 'hotel');
</script>

<Modal title="Add a booking" {onclose}>
	<form class="body" method="POST" action="?/addBooking" enctype="multipart/form-data">
		<ActionError {message} />

		<div class="grid">
			<Field label="What kind">
				<select name="kind" bind:value={kind}>
					{#each kinds as option (option)}
						<option value={option}>{option[0].toUpperCase() + option.slice(1)}</option>
					{/each}
				</select>
			</Field>
			<Field label="What is it">
				<input name="title" placeholder="Prague → Porto" required />
			</Field>

			<Field label="Day">
				<input type="date" name="startsOn" value={startsOn} min={startsOn} max={endsOn} required />
			</Field>
			<Field label="Time">
				<input type="time" name="startsAt" />
				<span class="hint">Optional.</span>
			</Field>

			{#if isStay}
				<Field label="Until">
					<input type="date" name="endsOn" min={startsOn} max={endsOn} />
					<span class="hint">The morning you leave.</span>
				</Field>
			{/if}

			<Field label="Reference">
				<input name="reference" placeholder="QR7T2M" />
				<span class="hint">Optional. The code on the confirmation.</span>
			</Field>
		</div>

		<!-- The confirmation, at the same moment as the booking rather than as a
		     second errand afterwards. The same control documents use, so the file,
		     the camera and the scanner are all offered here too; it is optional,
		     because a booking somebody was told about on the phone has no paper. -->
		<div class="paper">
			<span class="paper-label">The confirmation</span>
			<UploadDropzone
				name="file"
				accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
				idleText="Drop it, photograph it, or scan it"
				description="PDF, JPEG, PNG, WebP or HEIC. Optional."
				reportErrors={false}
			/>
		</div>

		<div class="actions">
			<button class="btn" type="button" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" type="submit">Add it</button>
		</div>
	</form>
</Modal>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-6);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.paper {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.paper-label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}
</style>
