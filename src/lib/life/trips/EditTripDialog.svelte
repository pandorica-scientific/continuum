<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Changing a trip's head: what it is called, when, where, and who.
	 *
	 * The stamp is deliberately absent. It was resolved when the trip was made
	 * and stored, and renaming a trip must not silently repaint it — a stamp is
	 * a record of where somebody went, not a label that follows the title.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import { TRIP_EMOJI } from '$lib/life/trips/emoji';
	import { countryName } from '$lib/life/geo/countries';

	interface Destination {
		country: string;
		region: string | null;
		city: string | null;
	}

	let {
		trip,
		people,
		message = null,
		onclose
	}: {
		trip: {
			name: string;
			emoji: string;
			startsOn: string;
			endsOn: string;
			destinations: Destination[];
			members: { id: string }[];
		};
		people: { id: string; name: string }[];
		message?: string | null;
		onclose: () => void;
	} = $props();

	/**
	 * Read once, on purpose.
	 *
	 * The dialog is created fresh each time it opens, so `trip` cannot change
	 * underneath it — and making these derived would undo whatever the household
	 * typed the moment anything else on the page re-rendered.
	 */
	// svelte-ignore state_referenced_locally
	const first = trip.destinations[0];
	// svelte-ignore state_referenced_locally
	let emoji = $state(trip.emoji || '🧳');
	let country = $state(first?.country ?? '');
	const named = $derived(/^[A-Za-z]{2}$/.test(country) ? countryName(country) : '');

	const going = (id: string): boolean => trip.members.some((member) => member.id === id);
</script>

<Modal title="Edit trip" {onclose}>
	<form class="body" method="POST" action="?/edit">
		<ActionError {message} />

		<div class="grid">
			<Field label="Name">
				<input name="name" value={trip.name} required />
			</Field>
			<Field label="Mark">
				<EmojiPicker bind:value={emoji} name="emoji" choices={TRIP_EMOJI} />
			</Field>

			<Field label="Leaves">
				<input type="date" name="startsOn" value={trip.startsOn} required />
			</Field>
			<Field label="Comes back">
				<input type="date" name="endsOn" value={trip.endsOn} required />
			</Field>

			<Field label="Country">
				<input name="country" bind:value={country} maxlength="2" required />
				<span class="hint">{named || 'Two letters, like PT.'}</span>
			</Field>
			<Field label="City">
				<input name="city" value={first?.city ?? ''} />
			</Field>
			<Field label="Region">
				<input name="region" value={first?.region ?? ''} />
				<span class="hint">What lights up on the map.</span>
			</Field>
		</div>

		<fieldset class="who">
			<legend>Who is going</legend>
			{#each people as person (person.id)}
				<label class="person">
					<input type="checkbox" name="member" value={person.id} checked={going(person.id)} />
					{person.name}
				</label>
			{/each}
		</fieldset>

		<div class="actions">
			<button class="btn" type="button" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" type="submit">Save</button>
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
</style>
