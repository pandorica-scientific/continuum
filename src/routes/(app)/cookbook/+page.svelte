<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import ControlRow from '$lib/components/ControlRow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import CategoryRail from '$lib/life/cookbook/CategoryRail.svelte';
	import RecipeCard from '$lib/life/cookbook/RecipeCard.svelte';
	import RecipeDialog from '$lib/life/cookbook/RecipeDialog.svelte';
	import CategoryDialog from '$lib/life/cookbook/CategoryDialog.svelte';

	let { data, form } = $props();

	let query = $state('');
	/** null is "everything", which is where the screen opens. */
	let category = $state<string | null>(null);
	let tagFilter = $state<string | null>(null);
	let addingRecipe = $state(false);
	let addingCategory = $state(false);
	/** Set when the recipe dialog sent somebody off to make the first shelf. */
	let thenWriteRecipe = $state(false);

	// A rejected submission has to land back in the dialog it came from.
	$effect(() => {
		if (form?.on === 'recipe') addingRecipe = true;
		if (form?.on === 'category') addingCategory = true;
	});

	// The shelf they were sent to make now exists, so put them back where they
	// were going rather than leaving them to press New recipe a second time.
	$effect(() => {
		if (form?.added && thenWriteRecipe) {
			thenWriteRecipe = false;
			addingCategory = false;
			addingRecipe = true;
		}
	});

	const matches = (haystack: string): boolean =>
		query.trim() === '' || haystack.toLowerCase().includes(query.trim().toLowerCase());

	const visible = $derived(
		data.recipes.filter((recipe) => {
			if (category && recipe.categoryId !== category) return false;
			if (tagFilter && !recipe.tags.some((tag) => tag.id === tagFilter)) return false;
			return matches(
				`${recipe.name} ${recipe.description} ${recipe.tags.map((tag) => tag.name).join(' ')}`
			);
		})
	);

	// Only the tags something on this shelf actually carries. A filter row
	// offering "baking" while Weeknight is selected is a row of dead ends.
	const tagsHere = $derived.by(() => {
		const inScope = data.recipes.filter((recipe) => !category || recipe.categoryId === category);
		// A plain record, not a Map: this is derived and read, never mutated, and
		// `svelte/prefer-svelte-reactivity` is right that a bare Map in a
		// component is usually a reactivity bug waiting to happen.
		const seen: Record<string, (typeof data.tags)[number]> = {};
		for (const recipe of inScope) for (const tag of recipe.tags) seen[tag.id] = tag;
		return Object.values(seen).sort((a, b) => a.name.localeCompare(b.name));
	});
</script>

<ScreenHeader
	title="Cookbook"
	caption="What this household cooks. Photographed by whoever cooked it."
>
	{#snippet actions()}
		<button class="btn btn-primary" type="button" onclick={() => (addingRecipe = true)}>
			<Icon name="plus" size={16} /> New recipe
		</button>
	{/snippet}
</ScreenHeader>

<!-- No summary band. Cookbook has no figures worth a tile, and a screen with no
     figures has no band. -->
<ControlRow>
	{#snippet left()}
		<input
			type="search"
			bind:value={query}
			placeholder="Search recipes"
			aria-label="Search recipes"
		/>
		{#if tagsHere.length}
			<div class="chips" role="group" aria-label="Filter by tag">
				{#each tagsHere as tag (tag.id)}
					<button
						class="chip"
						class:on={tagFilter === tag.id}
						type="button"
						style:--ink="var(--{tag.series})"
						aria-pressed={tagFilter === tag.id}
						onclick={() => (tagFilter = tagFilter === tag.id ? null : tag.id)}
					>
						{tag.name}
					</button>
				{/each}
			</div>
		{/if}
	{/snippet}
</ControlRow>

<div class="shelf">
	<CategoryRail
		categories={data.categories}
		selected={category}
		total={data.recipes.length}
		onselect={(id) => {
			category = id;
			// A tag that nothing on the new shelf carries would filter it to
			// nothing and look like an empty shelf.
			if (tagFilter && !tagsHere.some((tag) => tag.id === tagFilter)) tagFilter = null;
		}}
		onadd={() => (addingCategory = true)}
	/>

	<div class="grid">
		{#each visible as recipe (recipe.id)}
			<RecipeCard
				href="/cookbook/{recipe.id}"
				name={recipe.name}
				emoji={recipe.emoji}
				description={recipe.description}
				minutes={recipe.minutes}
				servings={recipe.servings}
				photo={recipe.photo}
				art={recipe.art}
				tags={recipe.tags}
			/>
		{:else}
			<p class="empty">
				{#if data.recipes.length === 0}
					Nothing in the cookbook yet. The first one is usually whatever you cooked last night.
				{:else}
					Nothing here matches.
				{/if}
			</p>
		{/each}
	</div>
</div>

{#if addingRecipe}
	<RecipeDialog
		categories={data.categories}
		tags={data.tags}
		message={form?.on === 'recipe' ? form.message : null}
		onclose={() => (addingRecipe = false)}
		onneedcategory={() => {
			addingRecipe = false;
			thenWriteRecipe = true;
			addingCategory = true;
		}}
	/>
{/if}

{#if addingCategory}
	<CategoryDialog
		message={form?.on === 'category' ? form.message : null}
		onclose={() => {
			addingCategory = false;
			// Backing out of the shelf means backing out of the recipe too.
			thenWriteRecipe = false;
		}}
	/>
{/if}

<style>
	.shelf {
		display: grid;
		grid-template-columns: 232px minmax(0, 1fr);
		gap: var(--card-gap, 16px);
		align-items: start;
	}
	/* Fixed width, never stretched — the same rule as the idea board. */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, 268px);
		justify-content: start;
		gap: var(--card-gap, 16px);
	}
	.empty {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
		max-width: 52ch;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.chip {
		min-height: auto;
		padding: var(--space-2) var(--space-5);
		border: 1px solid color-mix(in srgb, var(--ink) 40%, transparent);
		border-radius: var(--radius-pill);
		background: none;
		color: color-mix(in srgb, var(--ink) 68%, var(--fg1));
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.chip.on {
		background: color-mix(in srgb, var(--ink) 18%, transparent);
	}

	/* The rail becomes a row of chips above the grid. */
	@media (max-width: 899px) {
		.shelf {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
