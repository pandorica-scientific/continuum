<script lang="ts">
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import ContactForm from '$lib/components/ContactForm.svelte';

	let { data, form } = $props();

	// Which contact the editor is open on: an id, 'new', or null for closed.
	let editing = $state<string | null>(null);

	const options = $derived(data.options);

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

<section class="section">
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
		<button class="btn btn-primary" type="button" onclick={() => (editing = 'new')}>
			New contact
		</button>
	</form>

	{#if form?.message}
		<p class="form-error" role="alert">{form.message}</p>
	{/if}

	<div class="eyebrow-row">
		<Eyebrow emoji="📇" label="Address book" />
		<span class="eyebrow-caption">
			{data.contacts.length}
			{data.contacts.length === 1 ? 'contact' : 'contacts'}
		</span>
	</div>

	{#if editing === 'new'}
		<ContactForm {options} values={form?.values} onclose={() => (editing = null)} />
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
			<ContactForm {options} {contact} values={form?.values} onclose={() => (editing = null)} />
		{:else}
			<article class="card contact-row">
				{#if contact.photo}
					<img class="avatar" src="/files/{contact.photo}" alt="" />
				{:else}
					<span class="avatar avatar-blank" aria-hidden="true">
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
						{#each labelsFor(contact) as label (label)}<span class="chip">{label}</span>{/each}
					</div>
				{/if}

				<button class="btn" type="button" onclick={() => (editing = contact.id)}>Edit</button>
			</article>
		{/if}
	{/each}
</section>

<style>
	.search-row {
		display: flex;
		gap: 8px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}

	.search {
		flex: 1 1 240px;
	}

	.contact-row {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: 10px 14px;
	}

	/* The avatar is decorative: the name beside it is the label, so an empty alt
	   keeps a screen reader from announcing the same person twice. */
	.avatar {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
		background: var(--card2);
	}

	.avatar-blank {
		display: grid;
		place-items: center;
		color: var(--fg3);
		font-weight: 600;
	}

	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.c-name {
		font-weight: 600;
	}

	.c-work,
	.reach {
		color: var(--fg3);
		font-size: 13px;
	}

	.reach {
		display: flex;
		flex-direction: column;
		text-align: right;
	}

	.linked {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		grid-column: 2 / -1;
	}

	.chip {
		font-size: 12px;
		color: var(--fg3);
		border: 1px solid var(--bd2);
		border-radius: 999px;
		padding: 2px 8px;
	}

	.form-error {
		color: var(--red);
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
