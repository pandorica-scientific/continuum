<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/** A new shelf in the cookbook. A name and a mark; nothing else to decide. */
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import { DISH_EMOJI } from '$lib/life/cookbook/emoji';

	let { message = null, onclose }: { message?: string | null; onclose: () => void } = $props();

	let emoji = $state('🍽️');
</script>

<Modal title="New category" {onclose}>
	<!-- Enhanced, so making a shelf does not reload the page. A reload would
	     throw away the screen's memory of why somebody was sent here, and the
	     recipe they were halfway to writing would not come back. -->
	<form class="body" method="POST" action="?/newCategory" use:enhance>
		<ActionError {message} />

		<div class="row">
			<Field label="Mark">
				<EmojiPicker bind:value={emoji} name="emoji" choices={DISH_EMOJI} />
			</Field>
			<Field label="Name">
				<input name="name" placeholder="Slow things" required />
			</Field>
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
	.row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
		gap: var(--space-6);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}
</style>
