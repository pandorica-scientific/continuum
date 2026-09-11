<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import CountryMap from '$lib/life/map/CountryMap.svelte';
	import { countryFlag } from '$lib/life/geo/countries';

	let { data } = $props();

	const flag = $derived(countryFlag(data.code));
</script>

<ScreenHeader
	title={data.name}
	caption={data.visited.years.length
		? `Visited in ${data.visited.years.join(', ')}.`
		: 'Nowhere here has been marked visited yet.'}
	emoji={flag || undefined}
>
	{#snippet actions()}
		<a class="btn" href="/map">‹ Map</a>
	{/snippet}
</ScreenHeader>

{#if data.world}
	<CountryMap
		code={data.code}
		slug={data.slug}
		outlineName={data.outlineName}
		world={data.world}
		visited={data.visited.regions}
		regionCount={data.regionCount}
	/>
{/if}

{#if data.visited.regions.length || data.visited.cities.length}
	<div class="lists">
		{#if data.visited.regions.length}
			<section class="card panel">
				<h2 class="label">Regions</h2>
				<ul>
					{#each data.visited.regions as region (region)}<li>{region}</li>{/each}
				</ul>
			</section>
		{/if}
		{#if data.visited.cities.length}
			<section class="card panel">
				<h2 class="label">Cities</h2>
				<ul>
					{#each data.visited.cities as city (city)}<li>{city}</li>{/each}
				</ul>
			</section>
		{/if}
	</div>
{/if}

<style>
	.lists {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: var(--card-gap, 16px);
		align-items: start;
	}
	.panel {
		padding: 18px 20px;
	}
	.label {
		margin: 0 0 var(--space-5);
		font-size: var(--text-xs);
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		padding: var(--space-2) var(--space-5);
		border-radius: var(--radius-pill);
		background: var(--rose-tint);
		color: var(--rose);
		font-size: var(--text-sm);
	}
</style>
