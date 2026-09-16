<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// What an identity document is, in fields: the kind, the country that issued
	// it, its number, and when.
	//
	// One component shared by both the Inbox and the inspector's edit form, so
	// the two copies can't drift out of sync. `readIdentityFields` on the server
	// reads whichever form posted it.
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
	 * Local state rather than `$derived`: rows are added and removed before
	 * saving, and a derived list would discard them. Seeded once — callers wrap
	 * this in `{#key documentId}` so a different document starts fresh.
	 */
	let rows = $state(untrack(() => numbers.map((n) => ({ ...n }))));
</script>

<!-- Typed by hand, every field optional. Nothing reads the document to fill
     these in: a wrongly guessed number is worse than an empty box. -->
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

<!-- One document can carry several numbers (a residence permit's card number
     and personal number), so no fixed ceiling. Clearing both halves of a row
     is how one goes: saving writes exactly what the form holds. -->
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
