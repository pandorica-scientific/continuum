<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import CountryMap from '$lib/life/map/CountryMap.svelte';
	import SightRow from '$lib/life/map/SightRow.svelte';
	import { submitAction } from '$lib/actions/result';
	import { countryFlag } from '$lib/life/geo/countries';
	import { countryColour } from '$lib/life/geo/country-colour';
	import { COUNTRY_COLOURS } from '$lib/life/geo/country-colour-table';

	let { data } = $props();

	const flag = $derived(countryFlag(data.code));
	/** The same token the map fills this country with. */
	const colour = $derived(countryColour(data.code, COUNTRY_COLOURS));
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
		geoVersion={data.geoVersion}
		who={data.who}
	/>
{/if}

<!--
	No band at all when nothing here has been engraved yet, rather than an empty
	heading. 203 of 3,422 places have artwork today, so most countries show
	nothing and fill in as batches land.
-->
{#if data.sights.length}
	<SightRow
		sights={data.sights}
		seen={data.seen}
		{colour}
		onseen={async (id) => {
			const body = new FormData();
			body.set('place', id);
			// The repo's own helper rather than a bare fetch: it deserializes the
			// action result, so a `fail(...)` is told apart from a transport error
			// instead of both arriving as a bare status code.
			const outcome = await submitAction('?/seen', body, { updatePage: false });
			return outcome.type === 'success';
		}}
	/>
{/if}
