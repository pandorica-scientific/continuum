<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Putting something on the Someday board.
	 *
	 * Deliberately shorter than the trip dialog: an idea has no dates and no
	 * bookings, and asking for them is what would turn the board into a
	 * planning tool. A name, where it is, one line on why, and who wants to go.
	 *
	 * The hearts are ticked here rather than left for afterwards because that is
	 * how an idea actually arrives — somebody says "we should go to Lofoten",
	 * and whether the other person agrees is the interesting part.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import StampPicker from '$lib/life/trips/StampPicker.svelte';
	import { TRIP_EMOJI } from '$lib/life/trips/emoji';
	import { countryName } from '$lib/life/geo/countries';

	let {
		people,
		message = null,
		onclose
	}: {
		people: { id: string; name: string }[];
		message?: string | null;
		onclose: () => void;
	} = $props();

	let country = $state('');
	let name = $state('');
	let emoji = $state('📍');
	const named = $derived(/^[A-Za-z]{2}$/.test(country) ? countryName(country) : '');
</script>

<Modal title="Add an idea" {onclose}>
	<form class="body" method="POST" action="?/addIdea">
		<ActionError {message} />

		<!-- The mark is a 36px button, so it takes a 36px column rather than an
		     equal share of the row: given a third of the width it left a hole
		     beside it and pushed the country onto its own line. -->
		<div class="row where">
			<Field label="Mark">
				<EmojiPicker bind:value={emoji} name="emoji" choices={TRIP_EMOJI} />
			</Field>
			<Field label="Where">
				<input name="name" bind:value={name} placeholder="Lofoten" required />
			</Field>
			<Field label="Country">
				<input name="country" bind:value={country} maxlength="2" />
				<span class="hint">{named || 'Optional. Two letters, like NO.'}</span>
			</Field>
		</div>

		<Field label="Why this one">
			<input name="note" placeholder="For the light in summer, when it does not go dark." />
		</Field>

		<StampPicker {name} {country} />

		<fieldset class="who">
			<legend>Who wants to go</legend>
			{#each people as person (person.id)}
				<label class="person">
					<input type="checkbox" name="heart" value={person.id} />
					{person.name}
				</label>
			{/each}
		</fieldset>

		<div class="actions">
			<button class="btn" type="button" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" type="submit">Put it on the board</button>
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
		align-items: start;
		gap: var(--space-6);
	}
	.where {
		grid-template-columns: auto minmax(0, 1fr) 148px;
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	input[name='country'] {
		text-transform: uppercase;
	}
	.who {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		flex-wrap: wrap;
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		padding: 0;
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	.person {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	/* One field per line on a phone, where three columns is three columns of
	   wrapped labels. */
	@media (max-width: 719px) {
		.row {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
