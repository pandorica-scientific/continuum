<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * A place the household went before Continuum existed.
	 *
	 * Country, where in it, which year, and who went. That is the whole thing:
	 * the years before this app are not a data-entry project, and a form asking
	 * for dates, companions and a trip name would make filling in a childhood
	 * holiday feel like filing a tax return.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import { COUNTRY_COLOURS } from '$lib/life/geo/country-colour-table';
	import { countryLabel } from '$lib/life/geo/countries';

	interface Person {
		id: string;
		name: string;
	}

	let {
		people,
		today,
		message = null,
		onclose
	}: {
		people: Person[];
		today: string;
		message?: string | null;
		onclose: () => void;
	} = $props();

	/**
	 * Every country the map can draw, named the way a person would say it.
	 *
	 * From the colour table rather than a list of its own: that table already
	 * holds exactly the codes this map has outlines for, so a country cannot be
	 * offered here and then fail to colour in.
	 */
	const countries = Object.keys(COUNTRY_COLOURS)
		.map((code) => ({ code, label: countryLabel(code) }))
		.sort((a, b) => a.label.localeCompare(b.label));

	/** Derived, not read once: `today` is a prop and a plain read would freeze it. */
	const thisYear = $derived(Number(today.slice(0, 4)));
</script>

<Modal title="Mark somewhere visited" {onclose}>
	<form class="body" method="POST" action="?/markVisited">
		<ActionError {message} />

		<div class="row">
			<Field label="Country">
				<select name="country" required>
					{#each countries as country (country.code)}
						<option value={country.code}>{country.label}</option>
					{/each}
				</select>
			</Field>
			<Field label="Year">
				<input type="number" name="year" value={thisYear} min="1900" max={thisYear} required />
			</Field>
		</div>

		<div class="row">
			<Field label="Region">
				<input name="region" placeholder="Douro" />
				<span class="hint">A province or a state, if you remember which.</span>
			</Field>
			<Field label="City">
				<input name="city" placeholder="Porto" />
			</Field>
		</div>

		{#if people.length}
			<fieldset class="who">
				<legend>Who went</legend>
				{#each people as person (person.id)}
					<label>
						<input type="checkbox" name="member" value={person.id} />
						{person.name}
					</label>
				{/each}
			</fieldset>
		{/if}

		<!-- Said out loud, because it is the rule that makes this safe to use: a
		     country scratched by hand must not be un-scratched because no trip in
		     the ledger explains it. -->
		<p class="note">
			Marked by hand, so nothing will remove it later — the trips sweep leaves these alone.
		</p>

		<div class="actions">
			<button class="btn" type="button" onclick={onclose}>Cancel</button>
			<button class="btn btn-primary" type="submit">Mark it</button>
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
		grid-template-columns: minmax(0, 1fr) 120px;
		align-items: start;
		gap: var(--space-6);
	}
	.row:nth-of-type(2) {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.who {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		padding: 0 0 var(--space-4);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	.who label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	@media (max-width: 719px) {
		.row,
		.row:nth-of-type(2) {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
