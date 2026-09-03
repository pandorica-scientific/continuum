<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import { personHues } from '$lib/people';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ContactForm from '$lib/components/ContactForm.svelte';
	import ActionError from '$lib/components/ActionError.svelte';

	let { data, form } = $props();

	// Which contact the editor was opened on by a click; undefined means nobody
	// has clicked anything yet on this render.
	let opened = $state<string | null | undefined>(undefined);

	// Which contact the editor is open on: an id, 'new', or null for closed.
	//
	// Falls back to whichever editor was just rejected, so a failed save reopens
	// the form it came from rather than closing and stranding the typed values.
	// The form is a plain POST, so a rejection is a fresh render of this page.
	const editing = $derived(
		opened === undefined ? (form?.values ? (form.valuesFor ?? 'new') : null) : opened
	);

	const options = $derived(data.options);

	/**
	 * The echoed values, but ONLY for the editor they came from.
	 *
	 * ContactForm prefers an echoed value over the stored row — which is right for
	 * the form that was rejected and catastrophic for any other, because the
	 * fields it pre-fills are then saved onto a different person's row.
	 */
	function echoFor(id: string | null): NonNullable<typeof form>['values'] | undefined {
		if (!form?.values) return undefined;
		return (form.valuesFor ?? null) === id ? form.values : undefined;
	}

	// The same stable assignment the household's own people get: sorted by id,
	// so a contact keeps their colour as the address book grows.
	const hues = $derived(personHues(data.contacts.map((c) => c.id)));

	function labelsFor(contact: (typeof data.contacts)[number]): string[] {
		const name = (list: { id: string; name: string }[], ids: string[]) =>
			ids
				.map((id) => list.find((entry) => entry.id === id)?.name)
				.filter((value): value is string => Boolean(value));

		return [
			...name(options.tenancies, contact.links.tenancyIds),
			...name(options.properties, contact.links.propertyIds),
			...name(options.loans, contact.links.loanIds),
			...name(options.accounts, contact.links.accountIds)
		];
	}
</script>

<ScreenHeader
	title="Contacts"
	caption="People and companies, and what in the household they are attached to."
/>

<section class="section" class:cards={editing === null}>
	<form class="search-row" method="GET">
		<input
			class="search"
			type="search"
			name="q"
			value={data.query}
			placeholder="Search by name or company"
			aria-label="Search contacts"
		/>
		<button class="btn" type="submit">Search</button>
		<button class="btn btn-primary" type="button" onclick={() => (opened = 'new')}>
			New contact
		</button>
	</form>

	<ActionError message={form?.message ?? null} />

	<div class="eyebrow-row">
		<Eyebrow hue="--indigo" emoji="📇" label="Address book" />
		<span class="eyebrow-caption">
			{data.contacts.length}
			{data.contacts.length === 1 ? 'contact' : 'contacts'}
		</span>
	</div>

	{#if editing === 'new'}
		<!-- No documents props: a contact that does not exist yet has nowhere to
		     file paper against, so `ContactForm` skips its card entirely. -->
		<ContactForm {options} values={echoFor(null)} onclose={() => (opened = null)} />
	{/if}

	{#if data.contacts.length === 0}
		<p class="empty">
			{#if data.query}
				Nothing matches “{data.query}”.
			{:else}
				No contacts yet. Add the people and companies the household deals with.
			{/if}
		</p>
	{/if}

	{#each data.contacts as contact (contact.id)}
		{#if editing === contact.id}
			<ContactForm
				{options}
				{contact}
				values={echoFor(contact.id)}
				documents={contact.documents}
				documentCandidates={contact.documentCandidates}
				addDocumentHref={contact.addDocumentHref}
				isAdmin={data.isAdmin}
				onclose={() => (opened = null)}
			/>
		{:else}
			<article class="card contact-row">
				{#if contact.photo}
					<img class="avatar" src="/files/{contact.photo}" alt="" />
				{:else}
					<span
						class="avatar avatar-blank"
						style:--contact-hue="var({hues.get(contact.id) ?? '--fg3'})"
						aria-hidden="true"
					>
						{contact.name.slice(0, 1).toUpperCase()}
					</span>
				{/if}

				<div class="who">
					<span class="c-name">{contact.name}</span>
					{#if contact.organisation || contact.jobTitle}
						<span class="c-work">
							{[contact.jobTitle, contact.organisation].filter(Boolean).join(' · ')}
						</span>
					{/if}
				</div>

				<div class="reach">
					{#if contact.phone}<a class="mono" href="tel:{contact.phone}">{contact.phone}</a>{/if}
					{#if contact.email}<a href="mailto:{contact.email}">{contact.email}</a>{/if}
				</div>

				{#if labelsFor(contact).length}
					<div class="linked">
						{#each labelsFor(contact) as label, i (i)}<span class="chip">{label}</span>{/each}
					</div>
				{/if}

				<button class="btn" type="button" onclick={() => (opened = contact.id)}>Edit</button>
			</article>
		{/if}
	{/each}
</section>

<style>
	.search-row {
		display: flex;
		gap: var(--space-4);
		margin-bottom: 12px;
		flex-wrap: wrap;
	}

	.search {
		flex: 1 1 240px;
	}

	/* Cards in a grid, not rows in a column. A contact is a person, not a line
	   item, and at four columns the phone number ended up further from the name
	   than the Edit button was. */
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: var(--space-6);
		align-items: start;
	}
	/* The toolbar and the count are the page's, not a card's. */
	.cards > .search-row,
	.cards > :global(.eyebrow-row),
	.cards > .empty {
		grid-column: 1 / -1;
	}
	.contact-row {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr) auto;
		align-items: start;
		gap: var(--space-4) var(--space-6);
	}

	/* The avatar is decorative: the name beside it is the label, so an empty alt
	   keeps a screen reader from announcing the same person twice. */
	.avatar {
		width: 44px;
		height: 44px;
		border-radius: var(--radius-pill);
		object-fit: cover;
		background: var(--card2);
		flex: none;
	}

	/* The initial in the contact's own series colour, the way a person's tag is
	   drawn everywhere else. Derived from the name so it is stable without a
	   stored preference. */
	.avatar-blank {
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--contact-hue, var(--fg3)) 24%, transparent);
		color: var(--fg1);
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.c-name {
		font-size: 15px;
		font-weight: 650;
		letter-spacing: -0.01em;
	}

	.c-work {
		color: var(--fg3);
		font-size: 12.5px;
	}
	.reach {
		font-size: 12.5px;
	}

	.reach {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		grid-column: 2;
	}
	.reach :global(a) {
		color: var(--blue);
	}

	.linked {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		grid-column: 2 / -1;
	}

	.chip {
		font-size: var(--text-sm);
		color: var(--fg3);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		padding: var(--space-1) var(--space-4);
	}

	@media (max-width: 40rem) {
		.contact-row {
			grid-template-columns: auto 1fr;
		}

		.reach {
			grid-column: 2;
			text-align: left;
		}
	}
</style>
