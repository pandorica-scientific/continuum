<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// Adds a tag to a transaction. Typing a name that does not exist yet creates
	// it, so a project can be started without visiting a settings screen first.
	let {
		transactionId,
		known,
		placeholder = 'Add tag…'
	}: {
		transactionId: string;
		known: { id: string; name: string }[];
		placeholder?: string;
	} = $props();

	const listId = `tags-${transactionId}`;
</script>

<input
	class="tag-input"
	name="tagName"
	list={listId}
	{placeholder}
	autocomplete="off"
	aria-label="Add a tag"
/>
<datalist id={listId}>
	{#each known as t (t.id)}
		<option value={t.name}></option>
	{/each}
</datalist>

<style>
	.tag-input {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: var(--radius-md);
		padding: 7px 11px;
		font-size: var(--text-md);
		width: 130px;
	}
</style>
