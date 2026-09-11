<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import SummaryBand from '$lib/components/SummaryBand.svelte';
	import ControlRow from '$lib/components/ControlRow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ShelfRail from '$lib/life/collections/ShelfRail.svelte';
	import BottleCard from '$lib/life/collections/BottleCard.svelte';
	import TypeChips from '$lib/life/collections/TypeChips.svelte';
	import OpenTonight from '$lib/life/collections/OpenTonight.svelte';
	import BottleDialog from '$lib/life/collections/BottleDialog.svelte';
	import { typeChips } from '$lib/life/collections/types';
	import type { EnumValue } from '$lib/enums';
	import type { Tile } from '$lib/components/tiles';

	let { data, form } = $props();

	let query = $state('');
	let typeFilter = $state<EnumValue<'bottle.type'> | null>(null);
	let sort = $state<'producer' | 'score' | 'vintage' | 'drink'>('producer');
	let adding = $state(false);
	/** Only one shelf exists in v0.9.0, but the rail selects one all the same. */
	let shelf = $state<string | null>(null);

	$effect(() => {
		if (form?.on === 'bottle') adding = true;
	});

	const selected = $derived(shelf ?? data.cellarId);

	const matches = (haystack: string): boolean =>
		query.trim() === '' || haystack.toLowerCase().includes(query.trim().toLowerCase());

	const visible = $derived.by(() => {
		const kept = data.bottles.filter((one) => {
			if (typeFilter && one.type !== typeFilter) return false;
			return matches(`${one.producer} ${one.name} ${one.region} ${one.grapeOrCask}`);
		});

		// Sorted on a copy: `data.bottles` is the loader's array, and sorting it
		// in place mutates what the next filter reads.
		return [...kept].sort((a, b) => {
			switch (sort) {
				case 'score':
					// Unscored last, never at the top ahead of a 95.
					return (b.score ?? -1) - (a.score ?? -1);
				case 'vintage':
					return (b.vintage ?? 0) - (a.vintage ?? 0);
				case 'drink':
					// The soonest window to close first; no window at all last.
					return (a.drinkTo ?? Number.POSITIVE_INFINITY) - (b.drinkTo ?? Number.POSITIVE_INFINITY);
				default:
					return a.producer.localeCompare(b.producer) || a.name.localeCompare(b.name);
			}
		});
	});

	const chips = $derived(typeChips(data.bottles));

	/** Bottles, not rows: three of one bottling is three bottles in the cellar. */
	const inCellar = $derived(data.bottles.reduce((sum, one) => sum + one.owned, 0));

	const tiles = $derived<Tile[]>([
		{ label: 'In the cellar', value: String(inCellar), note: 'Bottles, not bottlings' },
		{
			label: 'Opened this year',
			value: String(data.openedThisYear),
			note: 'Counts a logged tasting'
		},
		{
			label: 'Ready to drink',
			value: String(data.readyNow),
			// Only a task takes a colour. Nought ready is the state a cellar
			// wants to be in, and a yellow nought is an alarm about nothing.
			color: data.readyNow > 0 ? 'var(--yellow)' : undefined,
			note: 'Windows closing or closed'
		}
	]);
</script>

<ScreenHeader
	title="Collections"
	caption="Shelves of things you keep. The first one holds bottles."
>
	{#snippet actions()}
		<button
			class="btn btn-primary"
			type="button"
			disabled={!data.cellarId}
			onclick={() => (adding = true)}
		>
			<Icon name="plus" size={16} /> Add bottle
		</button>
	{/snippet}
</ScreenHeader>

<SummaryBand {tiles} />

<ControlRow>
	{#snippet left()}
		<input
			type="search"
			bind:value={query}
			placeholder="Search bottles"
			aria-label="Search bottles"
		/>
		<TypeChips {chips} selected={typeFilter} onselect={(type) => (typeFilter = type)} />
	{/snippet}
	{#snippet right()}
		<select bind:value={sort} aria-label="Sort bottles">
			<option value="producer">By producer</option>
			<option value="score">By score</option>
			<option value="vintage">By vintage</option>
			<option value="drink">By drink-by</option>
		</select>
	{/snippet}
</ControlRow>

<OpenTonight suggestions={data.suggestions} />

<div class="shelf">
	<ShelfRail shelves={data.shelves} {selected} onselect={(id) => (shelf = id)} />

	<div class="grid">
		{#each visible as one (one.id)}
			<BottleCard
				href="/collections/bottles/{one.id}"
				type={one.type}
				producer={one.producer}
				name={one.name}
				vintage={one.vintage}
				ageYears={one.ageYears}
				region={one.region}
				abv={one.abv}
				drinkFrom={one.drinkFrom}
				drinkTo={one.drinkTo}
				owned={one.owned}
				opened={one.opened}
				score={one.score}
				art={one.art}
				initials={one.initials}
				labelPhoto={one.labelPhoto}
				year={data.year}
			/>
		{:else}
			<p class="empty">
				{#if data.bottles.length === 0}
					Nothing in the cellar yet. The first one is usually whatever is already on the shelf.
				{:else}
					Nothing here matches.
				{/if}
			</p>
		{/each}
	</div>
</div>

{#if adding}
	<BottleDialog
		collectionId={selected}
		baseCurrency={data.baseCurrency}
		message={form?.on === 'bottle' ? form.message : null}
		onclose={() => (adding = false)}
	/>
{/if}

<style>
	.shelf {
		display: grid;
		grid-template-columns: 232px minmax(0, 1fr);
		gap: var(--card-gap, 16px);
		align-items: start;
	}
	/* Fixed width, never stretched — the same rule as the cookbook and the idea
	   board. */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, 268px);
		justify-content: start;
		gap: var(--card-gap, 16px);
	}
	.empty {
		margin: 0;
		max-width: 52ch;
		font-size: var(--text-md);
		color: var(--fg3);
	}

	@media (max-width: 899px) {
		.shelf {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
