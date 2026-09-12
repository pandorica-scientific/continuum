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
		who={data.who}
	/>
{/if}
