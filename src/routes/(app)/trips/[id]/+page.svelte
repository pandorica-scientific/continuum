<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PersonTag from '$lib/components/PersonTag.svelte';
	import BookingTimeline from '$lib/life/trips/BookingTimeline.svelte';
	import Readiness from '$lib/life/trips/Readiness.svelte';
	import BookingDialog from '$lib/life/trips/BookingDialog.svelte';
	import EditTripDialog from '$lib/life/trips/EditTripDialog.svelte';
	import AttachDialog from '$lib/life/trips/AttachDialog.svelte';
	import { countryFlag } from '$lib/life/geo/countries';

	let { data, form } = $props();

	const trip = $derived(data.trip);
	const hues = $derived(
		Object.fromEntries(data.people.map((person) => [person.id, person.hue])) as Record<
			string,
			string
		>
	);

	let addingBooking = $state(false);
	/** The booking whose confirmation is being attached, or null. */
	let attaching = $state<{ id: string; title: string } | null>(null);
	let editing = $state(false);
	/** Notes are read until somebody presses Edit, then Save and Cancel replace it. */
	let editingNotes = $state(false);

	// A rejected submission has to land back in the dialog it came from.
	$effect(() => {
		if (form?.on === 'booking' || form?.on === 'booking-file') addingBooking = true;
		if (form?.on === 'edit') editing = true;
	});

	const longDate = (iso: string): string =>
		new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
</script>

<ScreenHeader
	title={trip.name}
	caption="{longDate(trip.startsOn)} — {longDate(trip.endsOn)}"
	emoji={trip.emoji || undefined}
>
	{#snippet actions()}
		<a class="btn" href="/trips">‹ Trips</a>
		<button class="btn btn-primary" type="button" onclick={() => (addingBooking = true)}>
			<Icon name="plus" size={16} /> Add a booking
		</button>
	{/snippet}
</ScreenHeader>

<section class="section head card">
	<div class="facts">
		<div class="fact">
			<span class="label">Where</span>
			<span class="value">
				{#each trip.destinations as destination, i (destination.label)}
					{#if i > 0}<span class="dot" aria-hidden="true">·</span>{/if}
					<span aria-hidden="true">{countryFlag(destination.country)}</span>
					{destination.label}
				{/each}
			</span>
		</div>
		<div class="fact">
			<span class="label">Nights</span>
			<span class="value mono">{trip.nights}</span>
		</div>
		<div class="fact">
			<span class="label">Who</span>
			<span class="value people">
				{#each trip.members as member (member.id)}
					<PersonTag name={member.name} hue={hues[member.id] ?? '--fg3'} />
				{/each}
			</span>
		</div>
		<!-- Both ways of changing this trip, in the box that holds what they
		     change. Delete sits above Edit because it is the rarer and heavier of
		     the two, and putting it at the far foot of a long page meant scrolling
		     past the bookings to find it. -->
		<div class="fact edit">
			<form
				method="POST"
				action="?/delete"
				use:enhance={({ cancel }) => {
					// A trip carries its bookings and its places with it, and the visits
					// it wrote to the map are kept — so this asks once rather than
					// offering an undo that would have to reconstruct all of it.
					if (!confirm(`Delete ${trip.name}? Its bookings and places go with it.`)) cancel();
					return async ({ update }) => update();
				}}
			>
				<button class="link danger-link" type="submit">
					<Icon name="plus" size={14} /> Delete this trip
				</button>
			</form>
			<button class="link" type="button" onclick={() => (editing = true)}>
				<Icon name="pencil" size={14} /> Edit trip
			</button>
		</div>
	</div>
</section>

<section class="section">
	<Eyebrow
		icon="lock"
		label="Readiness"
		hue="--rose"
		caption="Read from the wallet, not typed in here."
	/>
	<div class="card pad">
		<Readiness lines={data.readiness} {hues} caption={data.visaCaption} />
	</div>
</section>

<section class="section">
	<Eyebrow icon="suitcase" label="Bookings" hue="--rose" caption="In the order they happen." />
	<div class="card pad">
		<BookingTimeline
			bookings={trip.bookings}
			ondelete
			onattach={(booking) => (attaching = { id: booking.id, title: booking.title })}
		/>
	</div>
</section>

<section class="section">
	<Eyebrow
		icon="pin"
		label="Places"
		hue="--rose"
		caption="Things to see. Ticking them is optional."
	/>
	<div class="card pad">
		{#if trip.places.length}
			<ul class="places">
				{#each trip.places as place (place.id)}
					<li class="place-row">
						<form method="POST" action="?/togglePlace" use:enhance>
							<input type="hidden" name="id" value={place.id} />
							<button class="place" type="submit" aria-pressed={place.done}>
								<span class="box" class:done={place.done}>
									{#if place.done}<Icon name="check" size={13} />{/if}
								</span>
								<span class="place-label" class:struck={place.done}>{place.label}</span>
							</button>
						</form>
						<form method="POST" action="?/deletePlace" use:enhance>
							<input type="hidden" name="id" value={place.id} />
							<button class="remove" type="submit" aria-label="Remove {place.label}">
								<Icon name="plus" size={13} />
							</button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			class="add"
			method="POST"
			action="?/addPlace"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: true })}
		>
			<input name="label" placeholder="Something to see" aria-label="Something to see" />
			<button class="btn" type="submit">Add</button>
		</form>
	</div>
</section>

<section class="section">
	<Eyebrow icon="ledger" label="Notes" hue="--rose" />
	<div class="card pad">
		{#if editingNotes}
			<!-- Save and Cancel replace the control that opened the form, rather
			     than sitting at the far end of a long page. -->
			<form
				method="POST"
				action="?/saveNotes"
				use:enhance={() =>
					async ({ update }) => {
						editingNotes = false;
						await update({ reset: false });
					}}
			>
				<textarea name="notes" rows="5" aria-label="Notes">{trip.notes}</textarea>
				<div class="note-actions">
					<button class="btn" type="button" onclick={() => (editingNotes = false)}>Cancel</button>
					<button class="btn btn-primary" type="submit">Save</button>
				</div>
			</form>
		{:else}
			<div class="note-read">
				{#if trip.notes}
					<p class="notes">{trip.notes}</p>
				{:else}
					<p class="notes quiet">Nothing written down.</p>
				{/if}
				<button class="link" type="button" onclick={() => (editingNotes = true)}>
					<Icon name="pencil" size={14} /> Edit
				</button>
			</div>
		{/if}
	</div>
</section>

{#if addingBooking}
	<BookingDialog
		kinds={data.bookingKinds}
		startsOn={trip.startsOn}
		endsOn={trip.endsOn}
		message={form?.on === 'booking' || form?.on === 'booking-file' ? form.message : null}
		onclose={() => (addingBooking = false)}
	/>
{/if}

{#if attaching}
	<AttachDialog
		booking={attaching}
		message={form?.on === 'attach' ? form.message : null}
		onclose={() => (attaching = null)}
	/>
{/if}

{#if editing}
	<EditTripDialog
		{trip}
		people={data.people}
		message={form?.on === 'edit' ? form.message : null}
		onclose={() => (editing = false)}
	/>
{/if}

<style>
	.pad {
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.head {
		padding: 18px 20px;
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: var(--space-6);
	}
	.fact {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.fact.edit {
		justify-content: flex-end;
		align-items: flex-end;
		gap: var(--space-4);
	}
	.label {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	.value {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.people {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.dot {
		margin: 0 var(--space-2);
		color: var(--fg3);
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		min-height: auto;
		padding: 0;
		border: 0;
		background: none;
		font-size: var(--text-sm);
		color: var(--blue);
	}
	.link:hover {
		text-decoration: underline;
	}
	.places {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.place-row {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.place-row form:first-child {
		flex: 1;
		min-width: 0;
	}
	.place {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		width: 100%;
		min-height: auto;
		padding: var(--space-2) 0;
		border: 0;
		background: none;
		color: inherit;
		text-align: left;
	}
	.box {
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		flex: none;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-xs);
		color: var(--fg-inverse);
	}
	.box.done {
		border-color: var(--green);
		background: var(--green);
	}
	.place-label {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.struck {
		color: var(--fg3);
		text-decoration: line-through;
	}
	/* The ✕ again, rotated out of `plus` so the set needs no second glyph. */
	.remove {
		width: 24px;
		height: 24px;
		min-height: auto;
		display: grid;
		place-items: center;
		flex: none;
		padding: 0;
		border: 0;
		background: none;
		color: var(--fg3);
		transform: rotate(45deg);
	}
	.remove:hover {
		color: var(--red);
	}
	.add {
		display: flex;
		gap: var(--space-4);
		align-items: center;
	}
	.add input {
		flex: 1;
		min-width: 0;
	}
	.note-read {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-6);
	}
	.notes {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg2);
		white-space: pre-wrap;
		max-width: 70ch;
	}
	textarea {
		width: 100%;
		resize: vertical;
	}
	.note-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
		padding-top: var(--space-5);
	}
	.danger-link {
		color: var(--red);
	}
	/* The ✕ out of `plus` again, so the set needs no second glyph for it. */
	.danger-link :global(svg) {
		transform: rotate(45deg);
	}
</style>
