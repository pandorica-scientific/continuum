<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	//
	// Settings → Shelves. One card, 620px, because a settings list spanning the
	// whole window is unreadable. Add is an inline row rather than a dialog — a
	// dialog for one text field is the wizard this module rules out.
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import ShelfRow from '$lib/components/ShelfRow.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import Modal from '$lib/components/Modal.svelte';

	let { data, form } = $props();

	let order = $state<string[]>([]);
	let dragging = $state<string | null>(null);
	let renaming = $state<string | null>(null);
	let deleting = $state<string | null>(null);
	let newEmoji = $state('🗂️');
	let reassignTo = $state('');

	const shelves = $derived(
		order.length
			? (order
					.map((id) => data.shelves.find((s) => s.id === id)!)
					.filter(Boolean) as typeof data.shelves)
			: data.shelves
	);
	const target = $derived(data.shelves.find((s) => s.id === deleting) ?? null);
	const elsewhere = $derived(data.shelves.filter((s) => s.id !== deleting));

	$effect(() => {
		void data.shelves;
		order = [];
		renaming = null;
		deleting = null;
	});

	function moveOver(id: string) {
		if (!dragging || dragging === id) return;
		const ids = shelves.map((s) => s.id);
		const from = ids.indexOf(dragging);
		const to = ids.indexOf(id);
		if (from < 0 || to < 0) return;
		ids.splice(to, 0, ids.splice(from, 1)[0]);
		order = ids;
	}
</script>

<ScreenHeader
	title="Shelves"
	caption="Where in life a document belongs. Rename them, reorder them, make your own."
>
	{#snippet actions()}
		<a class="btn" href="/documents">← Back to documents</a>
	{/snippet}
</ScreenHeader>

{#if form?.message}
	<div class="error" role="alert">{form.message}</div>
{/if}

<div class="card" role="list">
	{#each shelves as s (s.id)}
		{#if renaming === s.id}
			<!-- The same 52px row, with the label swapped for a field: renaming
			     happens in the place the shelf sits, not in a dialog. -->
			<form class="rename" method="POST" action="?/rename" use:enhance>
				<input type="hidden" name="id" value={s.id} />
				<span class="spacer"></span>
				<EmojiPicker name="emoji" value={s.emoji} />
				<input name="label" value={s.label} aria-label="Shelf name" />
				<button type="submit" class="btn btn-primary">Save</button>
				<button type="button" class="btn" onclick={() => (renaming = null)}>Cancel</button>
			</form>
		{:else}
			<ShelfRow
				shelf={s}
				dragging={dragging === s.id}
				ondragstart={() => (dragging = s.id)}
				ondragover={() => moveOver(s.id)}
				ondrop={() => (dragging = null)}
				onrename={() => (renaming = s.id)}
				ondelete={() => {
					deleting = s.id;
					reassignTo = elsewhere[0]?.id ?? '';
				}}
			/>
		{/if}
	{/each}

	<!-- The add row is the last row of the same card, in the position the new
	     shelf will occupy. One field; a dialog for one field is a wizard. -->
	<form class="add" method="POST" action="?/add" use:enhance>
		<span class="spacer"></span>
		<EmojiPicker name="emoji" bind:value={newEmoji} dashed />
		<input name="label" placeholder="New shelf name" aria-label="New shelf name" />
		<button type="submit" class="btn">Add</button>
	</form>
</div>

{#if order.length}
	<form method="POST" action="?/reorder" use:enhance>
		<input type="hidden" name="order" value={order.join(',')} />
		<button type="submit" class="btn btn-primary">Save order</button>
	</form>
{/if}

{#if target}
	<Modal onclose={() => (deleting = null)} title={`Delete “${target.label}”?`}>
		<form method="POST" action="?/remove" use:enhance>
			<input type="hidden" name="id" value={target.id} />
			<p class="quiet">
				Delete “{target.label}”? <span class="mono">{target.count}</span>
				{target.count === 1 ? 'document needs' : 'documents need'} another shelf first.
			</p>
			<label>
				<span class="eyebrow">Move them to</span>
				<select name="reassignTo" bind:value={reassignTo}>
					{#each elsewhere as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
				</select>
			</label>
			<div class="modal-actions">
				<button type="button" class="btn" onclick={() => (deleting = null)}>Cancel</button>
				<button type="submit" class="btn btn-primary">Move &amp; delete</button>
			</div>
		</form>
	</Modal>
{/if}

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.card {
		max-width: 620px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--card);
		overflow: hidden;
	}
	.add,
	.rename {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		height: 52px;
		padding: 0 var(--space-5);
		border-bottom: 1px solid var(--bd);
	}
	.add {
		border-bottom: 0;
	}
	/* The handle's column, kept empty so the emoji lines up with the rows above. */
	.spacer {
		width: 28px;
		flex: none;
	}
	.add input,
	.rename input,
	select {
		height: var(--control-h);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--fg1);
		padding: 0 10px;
		font-size: var(--text-md);
		flex: 1 1 200px;
	}
	.modal-actions {
		display: flex;
		gap: var(--space-4);
		align-items: center;
	}
	.quiet {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
