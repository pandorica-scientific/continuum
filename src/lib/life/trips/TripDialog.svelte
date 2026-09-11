<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Making a trip, over the board rather than away from it.
	 *
	 * The same form the `/trips/new` route renders, so a household with script
	 * switched off still gets a page it can fill in — the buttons that open this
	 * are real links to that route, and this only takes over the click when it
	 * can. That is also what makes "Make this a trip" keep its meaning: the idea
	 * stays visible behind the dialog, which is the thing being turned into a
	 * trip.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import StampPicker from '$lib/life/trips/StampPicker.svelte';
	import { TRIP_EMOJI } from '$lib/life/trips/emoji';
	import { countryName } from '$lib/life/geo/countries';

	interface Person {
		id: string;
		name: string;
	}

	interface Idea {
		id: string;
		name: string;
		emoji: string;
		country: string | null;
		hearts: { id: string }[];
	}

	let {
		idea = null,
		people,
		message = null,
		onclose
	}: {
		/** Set when an idea is being promoted; null for a trip from nothing. */
		idea?: Idea | null;
		people: Person[];
		message?: string | null;
		onclose: () => void;
	} = $props();

	/**
	 * Capturing the initial value is exactly right here, which is why the
	 * compiler's warning is suppressed rather than followed.
	 *
	 * The dialog is created fresh every time it opens — the page renders it
	 * behind an `{#if}` — so `idea` cannot change underneath it. Making this a
	 * `$derived` would undo whatever the household typed the moment anything
	 * else on the page re-rendered.
	 */
	// svelte-ignore state_referenced_locally
	let country = $state(idea?.country ?? '');
	// svelte-ignore state_referenced_locally
	let name = $state(idea?.name ?? '');
	// svelte-ignore state_referenced_locally
	let emoji = $state(idea?.emoji || '🧳');
	let city = $state('');
	const named = $derived(/^[A-Za-z]{2}$/.test(country) ? countryName(country) : '');

	// Whoever wanted to go is who is going, until somebody says otherwise. With
	// no idea behind it, everybody is going.
	const wants = (person: Person): boolean =>
		idea ? idea.hearts.some((heart) => heart.id === person.id) : true;
</script>

<Modal title={idea ? `Make ${idea.name} a trip` : 'New trip'} {onclose}>
	<form class="body" method="POST" action="?/newTrip">
		{#if idea}
			<input type="hidden" name="fromIdeaId" value={idea.id} />
		{/if}

		<ActionError {message} />

		<!-- Three rows, each with the columns its own fields want, rather than one
		     grid of equal thirds: the mark is a 36px button and a date is a fixed
		     width, and giving each an equal share left holes beside them and
		     pushed Region onto a line of its own. -->
		<div class="row identity">
			<Field label="Mark">
				<EmojiPicker bind:value={emoji} name="emoji" choices={TRIP_EMOJI} />
			</Field>
			<Field label="Name">
				<input name="name" bind:value={name} required />
			</Field>
			<Field label="Leaves">
				<input type="date" name="startsOn" required />
			</Field>
			<Field label="Comes back">
				<input type="date" name="endsOn" required />
			</Field>
		</div>

		<div class="row where">
			<Field label="Country">
				<input name="country" bind:value={country} maxlength="2" required />
				<span class="hint">{named || 'Two letters, like PT.'}</span>
			</Field>
			<Field label="City">
				<input name="city" bind:value={city} />
				<span class="hint">A city we have a drawing for gets its own stamp.</span>
			</Field>
			<Field label="Region">
				<input name="region" />
				<span class="hint">What lights up on the map.</span>
			</Field>
		</div>

		<StampPicker {name} {country} {city} />

		<fieldset class="who">
			<legend>Who is going</legend>
			{#each people as person (person.id)}
				<label class="person">
					<input type="checkbox" name="member" value={person.id} checked={wants(person)} />
					{person.name}
				</label>
			{/each}
		</fieldset>

		<!-- Save and Cancel replace the control that opened the form. -->
		<div class="actions">
			<button class="btn" type="button" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" type="submit">Make the trip</button>
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
	.identity {
		grid-template-columns: auto minmax(0, 1fr) 170px 170px;
	}
	.where {
		grid-template-columns: 148px minmax(0, 1fr) minmax(0, 1fr);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* Typed lower case, stored upper case — the server upper-cases it, and this
	   is so the field agrees with what will be saved. */
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

	/* Two columns at rail width, one on a phone. Four across 400px is four
	   columns of wrapped labels. */
	@media (max-width: 1000px) {
		.identity,
		.where {
			grid-template-columns: auto minmax(0, 1fr);
		}
	}
	@media (max-width: 719px) {
		.identity,
		.where {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
