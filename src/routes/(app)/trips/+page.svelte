<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import SummaryBand from '$lib/components/SummaryBand.svelte';
	import ControlRow from '$lib/components/ControlRow.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IdeaCard from '$lib/life/trips/IdeaCard.svelte';
	import TripRow from '$lib/life/trips/TripRow.svelte';
	import StampWall from '$lib/life/trips/StampWall.svelte';
	import TripDialog from '$lib/life/trips/TripDialog.svelte';
	import IdeaDialog from '$lib/life/trips/IdeaDialog.svelte';
	import type { Tile } from '$lib/components/tiles';

	let { data, form } = $props();

	let query = $state('');

	/**
	 * Making a trip happens over the board, not away from it.
	 *
	 * `null` is closed, `'new'` is a trip from nothing, and an idea is one being
	 * promoted — with the card still visible behind the dialog, which is the
	 * thing being turned into a trip.
	 *
	 * The controls that open it stay real links to `/trips/new`, so the route is
	 * still there for a browser with script switched off; opening the dialog is
	 * what happens instead when the click can be taken.
	 */
	let making = $state<'new' | (typeof data.ideas)[number] | null>(null);
	let addingIdea = $state(false);

	// A rejected submission re-renders with a message, and the dialog it came
	// from has to still be open to show it — otherwise the error lands on a
	// screen with no form on it. `on` says which dialog that was.
	$effect(() => {
		if (form?.on === 'trip' && !making) making = 'new';
		if (form?.on === 'idea') addingIdea = true;
	});

	const hues = $derived(
		Object.fromEntries(data.people.map((person) => [person.id, person.hue])) as Record<
			string,
			string
		>
	);

	const tiles = $derived.by((): Tile[] => [
		{
			label: 'Upcoming trips',
			value: String(data.figures.upcoming),
			note:
				data.figures.nextInDays === null
					? 'nothing booked'
					: data.figures.nextInDays === 0
						? 'one starts today'
						: `next in ${data.figures.nextInDays} days`
		},
		{
			label: 'Nights booked',
			value: String(data.figures.nightsBooked),
			note: data.figures.upcoming === 1 ? 'on one trip' : `across ${data.figures.upcoming} trips`
		},
		{
			label: 'Needs a look',
			value: String(data.figures.needsALook),
			note:
				data.figures.needsALook === 0
					? 'everyone is ready'
					: data.figures.needsALook === 1
						? 'one trip wants attention'
						: 'trips wanting attention',
			// A task, so it takes a colour — and only when there is one.
			color: data.figures.needsALook > 0 ? 'var(--yellow)' : undefined
		},
		{
			label: 'Ideas on the board',
			value: String(data.figures.ideas),
			note:
				data.figures.ideasHeartedByAll > 0
					? `${data.figures.ideasHeartedByAll} hearted by everyone`
					: 'none agreed on yet'
		}
	]);

	const matches = (haystack: string): boolean =>
		query.trim() === '' || haystack.toLowerCase().includes(query.trim().toLowerCase());

	const visibleTrips = $derived(
		data.trips.filter((trip) =>
			matches(`${trip.name} ${trip.destinations.map((d) => d.label).join(' ')}`)
		)
	);
	const upcoming = $derived(visibleTrips.filter((trip) => trip.upcoming));
	const past = $derived(visibleTrips.filter((trip) => !trip.upcoming));
	const visibleIdeas = $derived(data.ideas.filter((idea) => matches(`${idea.name} ${idea.note}`)));

	/**
	 * Past trips grouped by the year they started, newest year first.
	 *
	 * Built as a plain record rather than a Map: this is derived and read, never
	 * mutated, and `svelte/prefer-svelte-reactivity` is right that a bare Map in
	 * a component is usually a reactivity bug waiting to happen.
	 */
	const years = $derived.by(() => {
		const byYear: Record<number, typeof past> = {};
		for (const trip of past) {
			byYear[trip.year] = [...(byYear[trip.year] ?? []), trip];
		}
		return Object.entries(byYear)
			.map(([year, trips]) => [Number(year), trips] as const)
			.sort(([a], [b]) => b - a);
	});

	/**
	 * The idea taken off the board, held for six seconds.
	 *
	 * Everything needed to put it back is kept here rather than fetched again:
	 * the row is already gone by the time the bar is shown.
	 */
	let undo = $state<{
		name: string;
		emoji: string;
		note: string;
		country: string | null;
		hearts: string[];
	} | null>(null);
	let undoTimer: ReturnType<typeof setTimeout> | null = null;

	function holdUndo(idea: (typeof data.ideas)[number]) {
		if (undoTimer) clearTimeout(undoTimer);
		undo = {
			name: idea.name,
			emoji: idea.emoji,
			note: idea.note,
			country: idea.country,
			hearts: idea.hearts.map((heart) => heart.id)
		};
		undoTimer = setTimeout(() => (undo = null), 6000);
	}
</script>

<ScreenHeader
	title="Trips"
	caption="Somewhere you would like to go, and the ones you are actually going on."
>
	{#snippet actions()}
		<a
			class="btn btn-primary"
			href="/trips/new"
			onclick={(event) => {
				event.preventDefault();
				making = 'new';
			}}
		>
			<Icon name="plus" size={16} /> New trip
		</a>
	{/snippet}
</ScreenHeader>

<SummaryBand {tiles} />

<ControlRow>
	{#snippet left()}
		<input
			type="search"
			bind:value={query}
			placeholder="Search trips and ideas"
			aria-label="Search trips and ideas"
		/>
	{/snippet}
</ControlRow>

<section class="section">
	<Eyebrow
		icon="sparkle"
		label="Someday"
		hue="--rose"
		caption="No dates, no bookings. Just the ones you keep coming back to."
	>
		{#snippet right()}
			<button class="btn" type="button" onclick={() => (addingIdea = true)}>
				<Icon name="plus" size={15} /> Add an idea
			</button>
		{/snippet}
	</Eyebrow>

	{#if visibleIdeas.length}
		<div class="board">
			{#each visibleIdeas as idea (idea.id)}
				<form
					method="POST"
					action="?/removeIdea"
					use:enhance={() => {
						holdUndo(idea);
						return async ({ update }) => update({ reset: false });
					}}
				>
					<input type="hidden" name="id" value={idea.id} />
					<IdeaCard
						name={idea.name}
						emoji={idea.emoji}
						note={idea.note}
						country={idea.country}
						hearts={idea.hearts}
						{hues}
						art={idea.art}
						makeHref="/trips/new?idea={idea.id}"
						onmake={() => (making = idea)}
					/>
				</form>
			{/each}
		</div>
	{:else}
		<p class="empty">
			Nothing on the board. Somewhere you have talked about going more than once is a good place to
			start.
		</p>
	{/if}
</section>

<section class="section">
	<Eyebrow icon="suitcase" label="Upcoming" hue="--rose" />
	{#if upcoming.length}
		<div class="rows">
			{#each upcoming as trip (trip.id)}
				<TripRow
					href="/trips/{trip.id}"
					name={trip.name}
					emoji={trip.emoji}
					destinations={trip.destinations}
					startsOn={trip.startsOn}
					endsOn={trip.endsOn}
					nights={trip.nights}
					members={trip.members}
					{hues}
					readiness={trip.readiness}
				/>
			{/each}
		</div>
	{:else}
		<p class="empty">Nothing booked.</p>
	{/if}
</section>

{#if years.length}
	<section class="section">
		<Eyebrow icon="globe" label="Past trips" hue="--rose" />
		<StampWall years={years.map(([year, trips]) => [year, trips])} initial={years[0]?.[0]} />
	</section>
{/if}

{#if addingIdea}
	<IdeaDialog
		people={data.people}
		message={form?.on === 'idea' ? form.message : null}
		onclose={() => (addingIdea = false)}
	/>
{/if}

{#if making}
	<TripDialog
		idea={making === 'new' ? null : making}
		people={data.people}
		message={form?.on === 'trip' ? form.message : null}
		onclose={() => (making = null)}
	/>
{/if}

<!-- At the component root, not inside the section: an idea removed while the
     reader has scrolled to the stamp wall has to say so where they are. -->
{#if undo}
	<div class="undo" role="status">
		<span>{undo.name} — off the board.</span>
		<form
			method="POST"
			action="?/restoreIdea"
			use:enhance={() => {
				undo = null;
				return async ({ update }) => update({ reset: false });
			}}
		>
			<input type="hidden" name="name" value={undo.name} />
			<input type="hidden" name="emoji" value={undo.emoji} />
			<input type="hidden" name="note" value={undo.note} />
			<input type="hidden" name="country" value={undo.country ?? ''} />
			{#each undo.hearts as heart (heart)}
				<input type="hidden" name="heart" value={heart} />
			{/each}
			<button class="undo-do" type="submit">Undo</button>
		</form>
		<button class="undo-x" type="button" onclick={() => (undo = null)} aria-label="Dismiss">
			<Icon name="plus" size={14} />
		</button>
	</div>
{/if}

<style>
	/* Fixed 268px, never stretched — see IdeaCard. */
	.board {
		display: grid;
		grid-template-columns: repeat(auto-fill, 268px);
		justify-content: start;
		gap: var(--card-gap, 16px);
	}
	/* Each card is wrapped in the form that removes it, so the FORM is the grid
	   item and the card inside it was free to be whatever height its note made
	   it — a row of cards with four different bottom edges. The grid stretches
	   the form; these two pass that height through to the card. */
	.board :global(form) {
		height: 100%;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.empty {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
		max-width: 52ch;
	}
	/* Floating, so it is painted with an opaque token and carries the float
	   shadow — the only thing telling a reader where the page stopped. */
	.undo {
		position: fixed;
		left: 50%;
		bottom: 28px;
		transform: translateX(-50%);
		z-index: 30;
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-5) 18px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--bg2);
		box-shadow: var(--shadow-float);
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.undo-do {
		min-height: auto;
		padding: 0;
		border: 0;
		background: none;
		font-size: var(--text-md);
		color: var(--blue);
	}
	.undo-do:hover {
		text-decoration: underline;
	}
	.undo-x {
		min-height: auto;
		width: 22px;
		height: 22px;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		background: none;
		color: var(--fg3);
		transform: rotate(45deg);
	}

	@media (max-width: 719px) {
		.undo {
			left: var(--space-6);
			right: var(--space-6);
			bottom: 84px;
			transform: none;
		}
	}
</style>
