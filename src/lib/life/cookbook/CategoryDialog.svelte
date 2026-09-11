<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * A shelf in the cookbook: made, renamed, re-marked, moved or taken away.
	 *
	 * One dialog rather than two, because a shelf has only a name and a mark —
	 * a separate "edit" screen would be the same two fields with a different
	 * title.
	 */
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { DISH_EMOJI } from '$lib/life/cookbook/emoji';

	interface Existing {
		id: string;
		name: string;
		emoji: string;
		count: number;
		/** Where it stands in the rail, so the ends know not to offer a move. */
		first: boolean;
		last: boolean;
	}

	let {
		/** Set to change a shelf; absent to make one. */
		category = null,
		message = null,
		onclose
	}: {
		category?: Existing | null;
		message?: string | null;
		onclose: () => void;
	} = $props();

	// Read once: the dialog is made fresh each time it opens.
	// svelte-ignore state_referenced_locally
	let emoji = $state(category?.emoji || '🍽️');
</script>

<Modal title={category ? `Edit ${category.name}` : 'New category'} {onclose}>
	<div class="body">
		<!-- Enhanced, so a shelf can be changed without reloading the screen
		     underneath and losing what else was open. -->
		<form
			class="main"
			method="POST"
			action={category ? '?/editCategory' : '?/newCategory'}
			use:enhance={() =>
				async ({ update }) => {
					await update();
					if (category) onclose();
				}}
		>
			<ActionError {message} />
			{#if category}
				<input type="hidden" name="categoryId" value={category.id} />
			{/if}

			<div class="row">
				<Field label="Mark">
					<EmojiPicker bind:value={emoji} name="emoji" choices={DISH_EMOJI} />
				</Field>
				<Field label="Name">
					<input name="name" value={category?.name ?? ''} placeholder="Slow things" required />
				</Field>
			</div>

			<div class="actions">
				<button class="btn" type="button" onclick={onclose}>Cancel</button>
				<button class="btn btn-primary" type="submit">{category ? 'Save' : 'Add it'}</button>
			</div>
		</form>

		{#if category}
			<div class="more">
				<!-- Order and removal are their own forms: they post a shelf, not the
				     name being typed above, and submitting one must not carry the
				     other's half-finished edit with it. -->
				<form method="POST" action="?/moveCategory" use:enhance>
					<input type="hidden" name="categoryId" value={category.id} />
					<span class="what">Where it sits</span>
					<button
						class="btn"
						type="submit"
						name="direction"
						value="up"
						disabled={category.first}
						aria-label="Move up the rail"
					>
						<Icon name="arrowUp" size={14} />
					</button>
					<button
						class="btn"
						type="submit"
						name="direction"
						value="down"
						disabled={category.last}
						aria-label="Move down the rail"
					>
						<Icon name="arrowDown" size={14} />
					</button>
				</form>

				<form
					method="POST"
					action="?/deleteCategory"
					use:enhance={({ cancel }) => {
						if (!confirm(`Take the ${category.name} shelf away?`)) cancel();
						return async ({ update, result }) => {
							await update();
							// A refusal has something to say, so the dialog stays open to
							// say it. A shelf that went has nothing left to show.
							if (result.type === 'success') onclose();
						};
					}}
				>
					<input type="hidden" name="categoryId" value={category.id} />
					<span class="what">
						{#if category.count > 0}
							{category.count}
							{category.count === 1 ? 'recipe stands here' : 'recipes stand here'}
						{:else}
							Nothing stands here
						{/if}
					</span>
					<button class="btn danger" type="submit" disabled={category.count > 0}>
						Take the shelf away
					</button>
				</form>
			</div>
		{/if}
	</div>
</Modal>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.main {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
		gap: var(--space-6);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}
	.more {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding-top: var(--space-6);
		border-top: 1px solid var(--bd);
	}
	.more form {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.what {
		flex: 1;
		min-width: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.danger {
		color: var(--red);
	}
	.danger:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--red) 55%, transparent);
	}
	.more button:disabled {
		opacity: 0.4;
	}
</style>
