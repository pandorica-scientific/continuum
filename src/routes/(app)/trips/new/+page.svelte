<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import { countryName } from '$lib/life/geo/countries';

	let { data, form } = $props();

	const idea = $derived(data.idea);
	const entered = $derived(form?.entered);

	// Seeded once from `data.idea?.country`, then left alone so typing over it isn't undone on rerender.
	let country = $state('');
	let seeded = false;
	$effect(() => {
		if (seeded) return;
		seeded = true;
		country = data.idea?.country ?? '';
	});
	const named = $derived(/^[A-Za-z]{2}$/.test(country) ? countryName(country) : '');
</script>

<ScreenHeader
	title={idea ? `Make ${idea.name} a trip` : 'New trip'}
	caption="Dates and where. Everything else can wait until it is booked."
>
	{#snippet actions()}
		<a class="btn" href="/trips">‹ Trips</a>
	{/snippet}
</ScreenHeader>

<form class="card pad" method="POST">
	{#if idea}
		<input type="hidden" name="fromIdeaId" value={idea.id} />
	{/if}

	<ActionError message={form?.message ?? null} />

	<div class="grid">
		<Field label="Name">
			<input name="name" value={entered?.name ?? idea?.name ?? ''} required />
		</Field>
		<Field label="Emoji">
			<input name="emoji" value={entered?.emoji ?? idea?.emoji ?? ''} maxlength="4" />
			<span class="hint">Optional. The household's own mark for it.</span>
		</Field>

		<Field label="Leaves">
			<input type="date" name="startsOn" value={entered?.startsOn ?? ''} required />
		</Field>
		<Field label="Comes back">
			<input type="date" name="endsOn" value={entered?.endsOn ?? ''} required />
		</Field>

		<Field label="Country">
			<input name="country" bind:value={country} maxlength="2" required />
			<span class="hint">{named || 'Two letters, like PT.'}</span>
		</Field>
		<Field label="City">
			<input name="city" value={entered?.city ?? ''} />
			<span class="hint">Optional. A city we have a drawing for gets its own stamp.</span>
		</Field>
		<Field label="Region">
			<input name="region" value={entered?.region ?? ''} />
			<span class="hint">Optional. What lights up on the map.</span>
		</Field>
	</div>

	<fieldset class="who">
		<legend>Who is going</legend>
		{#each data.people as person (person.id)}
			<label class="person">
				<input
					type="checkbox"
					name="member"
					value={person.id}
					checked={entered
						? entered.members.includes(person.id)
						: (idea?.members.includes(person.id) ?? true)}
				/>
				{person.name}
			</label>
		{/each}
	</fieldset>

	<div class="actions">
		<a class="btn" href="/trips">Cancel</a>
		<button class="btn btn-primary" type="submit">Make the trip</button>
	</div>
</form>

<style>
	.pad {
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		max-width: 720px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--space-6);
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
	.hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* Server upper-cases the value on save; display agrees with it. */
	input[name='country'] {
		text-transform: uppercase;
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
