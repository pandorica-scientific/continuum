<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Writing a recipe down.
	 *
	 * The ingredients and the steps are repeated rows rather than one textarea
	 * each: the servings scaler needs a quantity it can multiply, which means it
	 * needs to know which part of "250 g flour" is the number. A free-text block
	 * would have to be parsed, and a parser that is wrong once is wrong at the
	 * table.
	 *
	 * A row with no ingredient name is dropped on the way in, so the blank one
	 * waiting at the bottom costs nothing and there is no "add row" to press
	 * before typing.
	 */
	import Modal from '$lib/components/Modal.svelte';
	import Field from '$lib/components/Field.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { DISH_EMOJI } from '$lib/life/cookbook/emoji';
	import { MAX_SERVINGS, MIN_SERVINGS, quantityForInput } from '$lib/life/cookbook/scale';

	interface Category {
		id: string;
		name: string;
		emoji: string;
	}

	interface Existing {
		name: string;
		emoji: string;
		description: string;
		categoryId: string;
		servings: number;
		minutes: number | null;
		tags: { name: string }[];
		ingredients: { quantity: string | null; unit: string; name: string }[];
		steps: { body: string }[];
	}

	let {
		categories,
		tags,
		/** Set to edit an existing recipe; absent to write a new one. */
		recipe = null,
		message = null,
		onclose,
		onneedcategory
	}: {
		categories: Category[];
		tags: { id: string; name: string; series: string }[];
		recipe?: Existing | null;
		message?: string | null;
		onclose: () => void;
		/**
		 * Pressed when there is nowhere to put a recipe yet. Optional: the edit
		 * case always has at least the shelf the recipe is already on.
		 */
		onneedcategory?: () => void;
	} = $props();

	/**
	 * Read once. The dialog is created fresh each time it opens, so `recipe`
	 * cannot change underneath it — and making these derived would undo whatever
	 * was typed the moment anything else re-rendered.
	 */
	// svelte-ignore state_referenced_locally
	let emoji = $state(recipe?.emoji || '🍽️');

	// Whatever the recipe has, plus a blank row or three to type into: there is
	// no "add a row" to press before writing the next ingredient.
	// svelte-ignore state_referenced_locally
	let ingredientRows = $state((recipe?.ingredients.length ?? 0) + 3);
	// svelte-ignore state_referenced_locally
	let stepRows = $state((recipe?.steps.length ?? 0) + 2);

	const ingredientAt = (index: number) => recipe?.ingredients[index];
	const stepAt = (index: number) => recipe?.steps[index]?.body ?? '';
</script>

<Modal title={recipe ? `Edit ${recipe.name}` : 'New recipe'} {onclose}>
	{#if categories.length === 0}
		<!-- A cold start. The shelf field is required and there is nothing to pick,
		     so saying it plainly beats a browser telling somebody to choose from an
		     empty list. -->
		<div class="first">
			<p>
				A recipe goes on a shelf — Weeknight, Baking, whatever this household actually cooks — and
				there are no shelves yet.
			</p>
			<div class="actions">
				<button class="btn" type="button" onclick={onclose}>Cancel</button>
				<button class="btn btn-primary" type="button" onclick={onneedcategory}>
					<Icon name="plus" size={15} /> Make the first one
				</button>
			</div>
		</div>
	{:else}
		<form class="body" method="POST" action={recipe ? '?/edit' : '?/newRecipe'}>
			<ActionError {message} />

			<div class="row identity">
				<Field label="Mark">
					<EmojiPicker bind:value={emoji} name="emoji" choices={DISH_EMOJI} />
				</Field>
				<Field label="Name">
					<input
						name="name"
						value={recipe?.name ?? ''}
						placeholder="Ragù that takes all afternoon"
						required
					/>
				</Field>
				<Field label="Shelf">
					<select name="categoryId" value={recipe?.categoryId} required>
						{#each categories as category (category.id)}
							<option value={category.id}>{category.emoji} {category.name}</option>
						{/each}
					</select>
				</Field>
			</div>

			<Field label="One line on what it is">
				<input
					name="description"
					value={recipe?.description ?? ''}
					placeholder="The one worth starting before lunch."
				/>
			</Field>

			<div class="row numbers">
				<Field label="Serves">
					<input
						type="number"
						name="servings"
						value={recipe?.servings ?? 2}
						min={MIN_SERVINGS}
						max={MAX_SERVINGS}
						required
					/>
					<span class="hint">What the quantities below are for.</span>
				</Field>
				<Field label="Minutes">
					<input type="number" name="minutes" value={recipe?.minutes ?? ''} min="1" />
					<span class="hint">Optional.</span>
				</Field>
				<Field label="Tags">
					<input
						name="tag"
						list="cookbook-tags"
						value={recipe?.tags.map((tag) => tag.name).join(', ') ?? ''}
						placeholder="weeknight, guests"
					/>
					<datalist id="cookbook-tags">
						{#each tags as tag (tag.id)}<option value={tag.name}></option>{/each}
					</datalist>
					<span class="hint">Comma-separated. A new one is made as you type it.</span>
				</Field>
			</div>

			<fieldset class="lines">
				<legend>Ingredients</legend>
				{#each { length: ingredientRows }, index (index)}
					<div class="ingredient">
						<input
							name="quantity"
							value={quantityForInput(ingredientAt(index)?.quantity)}
							placeholder="250"
							aria-label="Quantity"
						/>
						<input
							name="unit"
							value={ingredientAt(index)?.unit ?? ''}
							placeholder="g"
							aria-label="Unit"
						/>
						<input
							name="ingredient"
							value={ingredientAt(index)?.name ?? ''}
							placeholder="plain flour"
							aria-label="Ingredient"
						/>
					</div>
				{/each}
				<button class="more" type="button" onclick={() => (ingredientRows += 3)}>
					<Icon name="plus" size={13} /> More rows
				</button>
				<span class="hint">
					Leave the quantity empty for something nobody measures — a splash, a handful. The scaler
					leaves those alone.
				</span>
			</fieldset>

			<fieldset class="lines">
				<legend>Steps</legend>
				{#each { length: stepRows }, index (index)}
					<div class="step">
						<span class="number mono">{index + 1}</span>
						<input name="step" value={stepAt(index)} aria-label="Step {index + 1}" />
					</div>
				{/each}
				<button class="more" type="button" onclick={() => (stepRows += 3)}>
					<Icon name="plus" size={13} /> More steps
				</button>
			</fieldset>

			<div class="actions">
				<button class="btn" type="button" onclick={onclose}>Cancel</button>
				<button class="btn btn-primary" type="submit">{recipe ? 'Save' : 'Write it down'}</button>
			</div>
		</form>
	{/if}
</Modal>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.first {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.first p {
		margin: 0;
		max-width: 46ch;
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.row {
		display: grid;
		align-items: start;
		gap: var(--space-6);
	}
	.identity {
		grid-template-columns: auto minmax(0, 1fr) 200px;
	}
	.numbers {
		grid-template-columns: 110px 110px minmax(0, 1fr);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.lines {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		border: 0;
	}
	legend {
		padding: 0 0 var(--space-4);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	.ingredient {
		display: grid;
		grid-template-columns: 88px 88px minmax(0, 1fr);
		gap: var(--space-3);
	}
	.step {
		display: grid;
		grid-template-columns: 24px minmax(0, 1fr);
		align-items: center;
		gap: var(--space-3);
	}
	.number {
		font-size: var(--text-sm);
		color: var(--fg3);
		text-align: right;
	}
	.more {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		min-height: auto;
		margin-top: var(--space-3);
		padding: 0;
		border: 0;
		background: none;
		font-size: var(--text-sm);
		color: var(--blue);
	}
	.more:hover {
		text-decoration: underline;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	@media (max-width: 719px) {
		.identity,
		.numbers {
			grid-template-columns: minmax(0, 1fr);
		}
		.ingredient {
			grid-template-columns: 72px 72px minmax(0, 1fr);
		}
	}
</style>
