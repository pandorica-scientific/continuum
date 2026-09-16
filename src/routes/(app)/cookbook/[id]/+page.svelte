<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ActionError from '$lib/components/ActionError.svelte';
	import UploadDropzone from '$lib/components/UploadDropzone.svelte';
	import TagChips from '$lib/life/cookbook/TagChips.svelte';
	import RecipeDialog from '$lib/life/cookbook/RecipeDialog.svelte';
	import {
		MAX_SERVINGS,
		MIN_SERVINGS,
		clampServings,
		scaleQuantity,
		servingsLabel
	} from '$lib/life/cookbook/scale';

	let { data, form } = $props();

	const recipe = $derived(data.recipe);

	/**
	 * What the household is cooking for right now — held apart from
	 * `recipe.servings` (what quantities are written for) so scaling always
	 * computes from the stored value, not the current display.
	 */
	let servings = $state(0);
	let seeded = false;
	$effect(() => {
		if (seeded) return;
		seeded = true;
		servings = recipe.servings;
	});

	const current = $derived(servings || recipe.servings);
	const scaled = $derived(current !== recipe.servings);

	let changingPhoto = $state(false);
	let editing = $state(false);

	// A rejected save has to land back in the dialog it came from.
	$effect(() => {
		if (form?.on === 'recipe') editing = true;
	});
</script>

<ScreenHeader
	title={recipe.name}
	caption={recipe.description || recipe.categoryName}
	emoji={recipe.emoji || undefined}
>
	{#snippet actions()}
		<a class="btn" href="/cookbook">‹ Cookbook</a>
		<button class="btn" type="button" onclick={() => (editing = true)}>
			<Icon name="pencil" size={15} /> Edit
		</button>
		<form
			method="POST"
			action="?/delete"
			use:enhance={({ cancel }) => {
				if (!confirm(`Delete ${recipe.name}?`)) cancel();
				return async ({ update }) => update();
			}}
		>
			<button class="btn danger" type="submit" aria-label="Delete this recipe">
				<Icon name="plus" size={15} />
			</button>
		</form>
	{/snippet}
</ScreenHeader>

<div class="top">
	<div class="photo card" class:empty={!recipe.photo && !changingPhoto}>
		{#if recipe.photo}
			<img src="/files/{recipe.photo}" alt="{recipe.name}, as it was cooked" />
			<form method="POST" action="?/removePhoto" use:enhance>
				<button class="over" type="submit">Remove photo</button>
			</form>
		{:else if changingPhoto}
			<form class="drop" method="POST" action="?/photo" enctype="multipart/form-data" use:enhance>
				<ActionError message={form?.on === 'photo' ? form.message : null} />
				<UploadDropzone
					name="photo"
					accept=".png,.jpg,.jpeg,.webp,.heic"
					idleText="Drop it, or photograph the dish"
					description="JPEG, PNG, WebP or HEIC"
					reportErrors={false}
				/>
				<div class="drop-actions">
					<button class="btn" type="button" onclick={() => (changingPhoto = false)}>Cancel</button>
					<button class="btn btn-primary" type="submit">Use it</button>
				</div>
			</form>
		{:else}
			<button class="slot" type="button" onclick={() => (changingPhoto = true)}>
				<span class="art">
					{#if recipe.art}
						<!-- Checked, not trusted: `assertInertSvg` runs inside `dishSvg`. -->
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						{@html recipe.art}
					{:else}
						<span class="fallback" aria-hidden="true">{recipe.emoji || '🍽️'}</span>
					{/if}
				</span>
				<span class="slot-text">
					Photograph of the finished dish
					<span class="slot-hint">Drop one here, or press to take it</span>
				</span>
			</button>
		{/if}
	</div>

	<div class="facts card">
		<TagChips tags={recipe.tags} limit={99} />

		<div class="line">
			<div class="stepper">
				<button
					class="step"
					type="button"
					aria-label="One fewer serving"
					disabled={current <= MIN_SERVINGS}
					onclick={() => (servings = clampServings(current - 1))}
				>
					<Icon name="plus" size={14} />
				</button>
				<span class="count">
					<span class="display">{current}</span>
					<span class="unit">serves</span>
				</span>
				<button
					class="step plus"
					type="button"
					aria-label="One more serving"
					disabled={current >= MAX_SERVINGS}
					onclick={() => (servings = clampServings(current + 1))}
				>
					<Icon name="plus" size={14} />
				</button>
			</div>
			{#if recipe.minutes}
				<span class="minutes">
					<Icon name="clock" size={14} />
					<span class="mono">{recipe.minutes}</span> min
				</span>
			{/if}
			{#if scaled}
				<button class="link" type="button" onclick={() => (servings = recipe.servings)}>
					Back to {servingsLabel(recipe.servings)}
				</button>
			{/if}
		</div>

		<p class="says">Quantities scale with the servings. Times and steps do not.</p>

		<dl class="meta">
			<div>
				<dt>Shelf</dt>
				<dd>{recipe.categoryName}</dd>
			</div>
			<div>
				<dt>Written for</dt>
				<dd><span class="mono">{recipe.servings}</span></dd>
			</div>
		</dl>
	</div>
</div>

<div class="cooking">
	<section class="card panel">
		<h2 class="label">Ingredients</h2>
		<ul class="ingredients">
			{#each recipe.ingredients as line (line.id)}
				<li>
					<span class="measure">
						<span class="mono">{scaleQuantity(line.quantity, recipe.servings, current)}</span>
						{#if line.unit}<span class="unit">{line.unit}</span>{/if}
					</span>
					<span class="ingredient-name">{line.name}</span>
				</li>
			{/each}
		</ul>
	</section>

	<section class="card panel">
		<h2 class="label">Steps</h2>
		<ol class="steps">
			{#each recipe.steps as step, index (step.id)}
				<li>
					<span class="number mono">{index + 1}</span>
					<span class="what">{step.body}</span>
				</li>
			{/each}
		</ol>
	</section>
</div>

{#if editing}
	<RecipeDialog
		categories={data.categories}
		tags={data.tags}
		{recipe}
		message={form?.on === 'recipe' ? form.message : null}
		onclose={() => (editing = false)}
	/>
{/if}

<style>
	.danger {
		color: var(--red);
	}
	/* The ✕ is the plus, turned. The set needs no second glyph for it. */
	.danger :global(svg) {
		transform: rotate(45deg);
	}
	.danger:hover {
		border-color: color-mix(in srgb, var(--red) 55%, transparent);
	}

	.top {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--card-gap, 16px);
		/* Not stretched: the facts card stays as tall as its content. */
		align-items: start;
	}
	.photo {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 16 / 9;
		overflow: hidden;
	}
	/* Dashed while empty: it reads as a slot waiting for something rather than
	   as a card that failed to load. */
	.photo.empty {
		border-style: dashed;
		background: none;
	}
	.photo img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.over {
		position: absolute;
		right: var(--space-5);
		bottom: var(--space-5);
		min-height: auto;
		padding: var(--space-3) var(--space-5);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		/* An opaque token: `--card` is translucent in the dark theme, and a
		   floating control painted with it looks right until somebody switches. */
		background: var(--bg2);
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.over:hover {
		color: var(--red);
	}
	.slot {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-5);
		width: 100%;
		height: 100%;
		min-height: auto;
		padding: var(--space-7);
		border: 0;
		background: none;
		color: var(--rose);
	}
	.art {
		display: block;
		line-height: 0;
	}
	/* The direct child only: `{@html}` puts the dish drawing straight into
	   `.art`, and an unscoped rule blows up every other icon on the page. */
	.art > :global(svg) {
		width: 96px;
		height: 96px;
	}
	.fallback {
		font-size: 56px;
		line-height: 1;
		opacity: 0.55;
	}
	.slot-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.slot-hint {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.drop {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		width: 100%;
		padding: 18px 20px;
	}
	.drop-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	.facts {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		padding: 18px 20px;
	}
	.line {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		flex-wrap: wrap;
	}
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-ctl);
		background: var(--card2);
	}
	.step {
		width: 26px;
		height: 26px;
		min-height: auto;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--fg2);
	}
	/* The minus is the plus with one stroke hidden, so the set needs no second
	   glyph for it. */
	.step:not(.plus) :global(svg line:first-child) {
		display: none;
	}
	.step:hover:not(:disabled) {
		background: var(--surface-3);
		color: var(--rose);
	}
	.step:disabled {
		opacity: 0.4;
	}
	.count {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-3);
	}
	.count .display {
		font-size: var(--display-xs);
	}
	.count .unit {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.minutes {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.says {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: var(--space-2) 0 0;
		padding-top: var(--space-5);
		border-top: 1px solid var(--bd);
	}
	.meta > div {
		display: flex;
		justify-content: space-between;
		gap: var(--space-5);
		font-size: var(--text-md);
	}
	.meta dt {
		color: var(--fg3);
	}
	.meta dd {
		margin: 0;
		color: var(--fg1);
	}
	.link {
		min-height: auto;
		padding: 0;
		border: 0;
		background: none;
		font-size: var(--text-sm);
		color: var(--blue);
	}
	.link:hover {
		text-decoration: underline;
	}

	.cooking {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
		gap: var(--card-gap, 16px);
		align-items: start;
	}
	.panel {
		padding: 18px 20px;
	}
	.label {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0 0 var(--space-4);
		font-size: var(--text-xs);
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	/* One grid over the whole list (rows are `display: contents`), so max-content
	   sizes the measure column to the widest actual measure, not a fixed gutter. */
	.ingredients {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		column-gap: var(--space-5);
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ingredients li {
		display: contents;
	}
	/* Rule on both cells, not the row — the row itself has no box. */
	.ingredients :is(.measure, .ingredient-name) {
		padding: var(--space-5) 0;
		border-top: 1px solid var(--bd);
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.ingredients li:first-child :is(.measure, .ingredient-name) {
		padding-top: 0;
		border-top: 0;
	}
	/* Right-aligned, so every ingredient name starts at the same edge and the
	   gap after the measure is the same on every line. */
	.measure {
		display: flex;
		align-items: baseline;
		justify-content: flex-end;
		/* Hair-thin: "500 g" is one measure, not two columns. */
		gap: 3px;
	}
	.measure .unit {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.ingredient-name {
		min-width: 0;
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.steps li {
		display: grid;
		grid-template-columns: 22px minmax(0, 1fr);
		gap: var(--space-5);
		font-size: var(--text-md);
		line-height: 1.5;
		color: var(--fg2);
	}
	.number {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-pill);
		background: var(--rose-tint);
		color: var(--rose);
		font-size: var(--text-2xs);
	}

	@media (max-width: 899px) {
		.top {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
