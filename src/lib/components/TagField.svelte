<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	//
	// Several tags on one record: the ones it has as chips, and one field to add
	// another. Typing offers every tag the household already has, so
	// "renovation" is picked rather than retyped as "renovations" — two tags for
	// one intention is the failure this control exists to prevent. A name that
	// matches nothing still creates a tag; a settings screen first would be a
	// second decision.
	//
	// The server folds case and whitespace (`normaliseTagName`), so the list
	// here folds the same way when it refuses a duplicate.
	let {
		tags = $bindable([]),
		known = [],
		name = 'tags',
		placeholder = 'Add a tag…'
	}: {
		tags?: string[];
		/** Every tag the household has, for the suggestions. */
		known?: string[];
		/** The field name each tag is posted under — one hidden input per tag. */
		name?: string;
		placeholder?: string;
	} = $props();

	let draft = $state('');
	const listId = `tag-field-${Math.random().toString(36).slice(2, 8)}`;

	const fold = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
	const suggestions = $derived(known.filter((k) => !tags.some((t) => fold(t) === fold(k))));

	function add(raw: string) {
		const value = raw.trim();
		if (!value) return;
		// Prefer the household's own spelling when the fold matches one it has.
		const existing = known.find((k) => fold(k) === fold(value));
		const chosen = existing ?? value;
		if (!tags.some((t) => fold(t) === fold(chosen))) tags = [...tags, chosen];
		draft = '';
	}

	function remove(value: string) {
		tags = tags.filter((t) => t !== value);
	}
</script>

{#each tags as t (t)}<input type="hidden" {name} value={t} />{/each}

<div class="field">
	{#each tags as t (t)}
		<span class="chip">
			{t}
			<button type="button" class="x" aria-label="Remove {t}" onclick={() => remove(t)}>✕</button>
		</span>
	{/each}
	<input
		list={listId}
		bind:value={draft}
		{placeholder}
		autocomplete="off"
		aria-label="Add a tag"
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ',') {
				e.preventDefault();
				add(draft);
			} else if (e.key === 'Backspace' && !draft && tags.length) {
				remove(tags[tags.length - 1]);
			}
		}}
		onchange={() => add(draft)}
		onblur={() => add(draft)}
	/>
	<datalist id={listId}>
		{#each suggestions as k (k)}<option value={k}></option>{/each}
	</datalist>
</div>

<style>
	.field {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--control-h);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card);
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		height: 26px;
		padding: 0 var(--space-3) 0 var(--space-5);
		border: 1px solid var(--bd);
		border-radius: var(--radius-chip);
		background: var(--card2);
		color: var(--fg1);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.x {
		border: 0;
		background: transparent;
		color: var(--fg3);
		font-size: var(--text-2xs);
		cursor: pointer;
		padding: 0 var(--space-2);
	}
	.x:hover {
		color: var(--fg1);
	}
	input {
		flex: 1 1 120px;
		min-width: 120px;
		height: 26px;
		border: 0;
		background: transparent;
		color: var(--fg1);
		font-size: var(--text-md);
		padding: 0 var(--space-3);
	}
	input:focus {
		outline: none;
	}
</style>
