<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	interface Option {
		id: string;
		name: string;
	}

	interface Links {
		tenancyIds: string[];
		propertyIds: string[];
		loanIds: string[];
		accountIds: string[];
	}

	interface ContactValues {
		id?: string;
		name: string;
		photo?: string | null;
		organisation: string | null;
		jobTitle: string | null;
		phone: string | null;
		email: string | null;
		address: string | null;
		notes: string | null;
		category: string | null;
		links?: Links;
	}

	let {
		options,
		contact = undefined,
		values = undefined,
		onclose
	}: {
		options: {
			tenancies: Option[];
			properties: Option[];
			loans: Option[];
			accounts: Option[];
		};
		contact?: ContactValues;
		/** Echoed back by the server when a submission was rejected, so a failed
		 *  save does not throw away what was typed. Takes precedence over the
		 *  stored row for exactly that reason. */
		values?: Partial<ContactValues>;
		onclose: () => void;
	} = $props();

	const field = (key: keyof ContactValues): string => {
		const echoed = values?.[key];
		if (typeof echoed === 'string') return echoed;
		const stored = contact?.[key];
		return typeof stored === 'string' ? stored : '';
	};

	const links = $derived(
		contact?.links ?? { tenancyIds: [], propertyIds: [], loanIds: [], accountIds: [] }
	);

	let clearPhoto = $state(false);

	const groups = $derived([
		{ label: 'Tenancies', name: 'tenancyIds', list: options.tenancies, chosen: links.tenancyIds },
		{
			label: 'Properties',
			name: 'propertyIds',
			list: options.properties,
			chosen: links.propertyIds
		},
		{ label: 'Loans', name: 'loanIds', list: options.loans, chosen: links.loanIds },
		{ label: 'Accounts', name: 'accountIds', list: options.accounts, chosen: links.accountIds }
	]);
</script>

<form class="card editor" method="POST" action="?/save" enctype="multipart/form-data">
	{#if contact?.id}<input type="hidden" name="id" value={contact.id} />{/if}
	<input type="hidden" name="existingPhoto" value={contact?.photo ?? ''} />
	{#if clearPhoto}<input type="hidden" name="clearPhoto" value="1" />{/if}

	<div class="grid">
		<label class="wide">
			<span>Name</span>
			<input name="name" value={field('name')} required autocomplete="off" />
		</label>

		<label>
			<span>Work place</span>
			<input name="organisation" value={field('organisation')} autocomplete="off" />
		</label>

		<label>
			<span>Job title</span>
			<input name="jobTitle" value={field('jobTitle')} autocomplete="off" />
		</label>

		<label>
			<span>Phone</span>
			<input name="phone" type="tel" value={field('phone')} autocomplete="off" />
		</label>

		<label>
			<span>Email</span>
			<input name="email" type="email" value={field('email')} autocomplete="off" />
		</label>

		<label class="wide">
			<span>Address</span>
			<input name="address" value={field('address')} autocomplete="off" />
		</label>

		<label class="wide">
			<span>Notes</span>
			<textarea name="notes" rows="2">{field('notes')}</textarea>
		</label>

		<label class="wide">
			<span>Photo</span>
			<input name="photo" type="file" accept="image/png,image/jpeg,image/webp" />
			{#if contact?.photo && !clearPhoto}
				<span class="photo-current">
					<img class="thumb" src="/files/{contact.photo}" alt="" />
					<button class="btn tick-add" type="button" onclick={() => (clearPhoto = true)}>
						Remove photo
					</button>
				</span>
			{/if}
		</label>
	</div>

	<div class="field belongs">
		<span>Attached to</span>
		{#each groups as group (group.name)}
			{#if group.list.length}
				<div class="belong-groups">
					<span class="group-label">{group.label}</span>
					{#each group.list as option (option.id)}
						<label class="tick">
							<input
								type="checkbox"
								name={group.name}
								value={option.id}
								checked={group.chosen.includes(option.id)}
							/>
							{option.name}
						</label>
					{/each}
				</div>
			{/if}
		{/each}
		{#if groups.every((group) => group.list.length === 0)}
			<span class="nothing">Nothing to attach to yet — add a property, loan or account first.</span>
		{/if}
	</div>

	<div class="actions">
		<button class="btn btn-primary" type="submit">Save</button>
		<button class="btn" type="button" onclick={onclose}>Cancel</button>
		{#if contact?.id}
			<button class="btn danger" type="submit" formaction="?/delete">Delete</button>
		{/if}
	</div>
</form>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px 14px;
	}

	.wide {
		grid-column: 1 / -1;
	}

	/* Field labels match the Documents add-form exactly: 12px, --fg3, 5px gap.
	   This form sits two clicks from that one and they should not look like two
	   different products. */
	label,
	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}

	.photo-current {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 5px;
	}

	.thumb {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		object-fit: cover;
		background: var(--card2);
	}

	.belongs {
		grid-column: 1 / -1;
	}

	.belong-groups {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 14px;
		align-items: center;
	}

	.group-label {
		min-width: 72px;
		color: var(--fg3);
	}

	.tick {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		font-size: var(--text-md);
		color: var(--fg1);
	}

	.tick input {
		width: auto;
	}

	.tick-add {
		padding: 5px 10px;
		font-size: var(--text-sm);
	}

	.nothing {
		color: var(--fg3);
	}

	.actions {
		display: flex;
		gap: 8px;
	}

	/* Destructive, but still a .btn: the app has exactly two button shapes and
	   inventing a third for this one would be the inconsistency, not the fix. */
	.danger {
		margin-left: auto;
		color: var(--red);
	}

	@media (max-width: 40rem) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
