<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// What an identity document is, in fields: the kind, the country that issued
	// it, its number, and when.
	//
	// One component in two places on purpose. The inspector's edit form had these
	// fields and the Inbox did not, so every passport filed from the Inbox
	// reached the wallet with no kind and no country — which meant generic
	// artwork, no flag, and a card titled "Identity document" until somebody
	// reopened it and filled the same form in again. Two copies of the markup
	// would have fixed that once and drifted the next time a field was added, so
	// there is one, and `readIdentityFields` on the server reads whichever form
	// posted it.
	import { untrack } from 'svelte';
	import { IDENTITY_KINDS, IDENTITY_KIND_LABELS } from '$lib/documents';
	import { countryOptions } from '$lib/countries';

	let {
		identity = null,
		numbers = []
	}: {
		/** What the document already says, or null for one being filed for the first time. */
		identity?: {
			kind: string;
			country: string | null;
			number: string | null;
			issuedOn: string | null;
			issuer: string | null;
		} | null;
		/** The extra numbers it already carries. */
		numbers?: { label: string; value: string }[];
	} = $props();

	/**
	 * Local state rather than `$derived`, because the form is being edited: rows
	 * are added and removed before anything is saved, and a derived list would
	 * discard them on the next load. Seeded once — callers wrap this component
	 * in `{#key documentId}` so a different document starts from its own rows.
	 */
	let rows = $state(untrack(() => numbers.map((n) => ({ ...n }))));
</script>

<!-- Typed by hand, every field optional. Nothing reads the document to fill
     these in: a number a recogniser guessed wrong is worse than an empty box,
     because it is believed. -->
<div class="id-grid">
	<label class="id-field">
		<span class="quiet">Kind</span>
		<select name="identityKind" value={identity?.kind ?? 'other'}>
			{#each IDENTITY_KINDS as kind (kind)}
				<option value={kind}>{IDENTITY_KIND_LABELS[kind]}</option>
			{/each}
		</select>
	</label>
	<label class="id-field">
		<span class="quiet">Country</span>
		<select name="identityCountry" value={identity?.country ?? ''}>
			<option value="">—</option>
			{#each countryOptions() as c (c.code)}
				<option value={c.code}>{c.name}</option>
			{/each}
		</select>
	</label>
	<label class="id-field">
		<span class="quiet">Number</span>
		<input class="mono" name="identityNumber" value={identity?.number ?? ''} />
	</label>
	<label class="id-field">
		<span class="quiet">Issued on</span>
		<input type="date" name="identityIssuedOn" value={identity?.issuedOn ?? ''} />
	</label>
	<label class="id-field wide">
		<span class="quiet">Issuer</span>
		<input name="identityIssuer" value={identity?.issuer ?? ''} />
	</label>
</div>

<!-- One document really can carry several numbers — a residence permit with a
     card number and a personal number, a licence with a national identifier
     beside it — and there is no sensible ceiling to guess at, so the household
     adds as many as it has. Clearing both halves of a row is how one goes:
     saving writes exactly what the form holds. -->
<div class="id-extra">
	{#each rows as extra, i (i)}
		<div class="id-extra-row">
			<input name="identityExtraLabel" placeholder="What it is called" value={extra.label} />
			<input class="mono" name="identityExtraValue" placeholder="Number" value={extra.value} />
			<button
				type="button"
				class="chip-x"
				aria-label="Remove {extra.label || 'this number'}"
				onclick={() => (rows = rows.filter((_, at) => at !== i))}>✕</button
			>
		</div>
	{/each}
	<button
		type="button"
		class="link id-add"
		onclick={() => (rows = [...rows, { label: '', value: '' }])}
	>
		+ Add another number
	</button>
</div>

<style>
	.id-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-4);
	}
	.id-field {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: var(--text-xs);
	}
	.id-field.wide {
		grid-column: 1 / -1;
	}
	.id-extra {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: var(--space-4);
	}
	/* Name and number on one line, with the way to remove it at the end: the
	   pair is one fact, and stacking them would read as two. */
	.id-extra-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-4);
	}
	.id-add {
		align-self: flex-start;
		font-size: var(--text-xs);
	}
</style>
