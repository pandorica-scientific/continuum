<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { goto } from '$app/navigation';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import SummaryBand from '$lib/components/SummaryBand.svelte';
	import ControlRow from '$lib/components/ControlRow.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import WorldMap from '$lib/life/map/WorldMap.svelte';
	import TimeZones from '$lib/life/map/TimeZones.svelte';
	import Continents from '$lib/life/map/Continents.svelte';
	import type { Tile } from '$lib/components/tiles';

	let { data } = $props();

	/** null is the household: the union of everybody, which is where it opens. */
	let member = $state<string | null>(null);

	const who = $derived([
		{ value: '', label: 'Household' },
		...data.people.map((one: { id: string; name: string }) => ({ value: one.id, label: one.name }))
	]);

	/**
	 * What counts as visited under the current filter — a filter over the one
	 * loaded shape, not a second query, so the two views can't disagree.
	 */
	const visited = $derived(
		new Set(
			data.countries.filter((one) => !member || one.members.includes(member)).map((one) => one.code)
		)
	);

	const regions = $derived(
		data.countries
			.filter((one) => !member || one.members.includes(member))
			.reduce((sum, one) => sum + one.regions.length, 0)
	);

	/** The two cards below follow the tab, not the household — else the tabs
	    would change the map but leave the progress cards alone. */
	const creditsHere = $derived(
		Object.fromEntries(Object.entries(data.credits).filter(([code]) => visited.has(code)))
	);

	const tiles = $derived<Tile[]>([
		{ label: 'Countries', value: String(visited.size), note: 'Where somebody has been' },
		{ label: 'Regions', value: String(regions), note: 'Provinces and states' },
		{
			label: 'Of the world',
			value: `${data.figures.percentOfWorld}`,
			unit: '%',
			note: 'Countries this map draws'
		}
	]);
</script>

<ScreenHeader
	title="Map"
	caption="Everywhere the household has been, under a coating you scratch off."
></ScreenHeader>

<SummaryBand {tiles} />

<ControlRow>
	{#snippet left()}
		<Segmented
			options={who}
			value={member ?? ''}
			onchange={(value) => (member = value === '' ? null : value)}
		/>
	{/snippet}
</ControlRow>

{#if data.geodata?.missing}
	<!-- A state, not a crash. The outlines are fetched at image-build time, so a
	     fresh checkout has none until somebody runs the script. -->
	<section class="card missing">
		<h2>The map outlines have not been fetched.</h2>
		<p>
			They are downloaded once at build time, like the OCR language data, and are not in the
			repository. Run this and reload:
		</p>
		<p class="command mono">{data.geodata.command}</p>
	</section>
{:else if data.world}
	<WorldMap
		world={data.world}
		codeByName={data.codeByName}
		{visited}
		onopen={(code) =>
			code &&
			goto(`/map/${code.toLowerCase()}${member ? `?who=${encodeURIComponent(member)}` : ''}`)}
	/>
{/if}

{#if data.world && !data.geodata?.missing}
	<div class="progress">
		{#if data.zones}
			<TimeZones
				bands={data.zones.bands}
				coastline={data.zones.coastline}
				zoneOf={data.zones.zoneOf}
				visited={[...visited]}
				total={data.zoneCount}
			/>
		{/if}
		<Continents
			credits={creditsHere}
			totals={data.continentTotals}
			areas={data.areas}
			geoVersion={data.geoVersion}
			places={data.places}
		/>
	</div>
{/if}

<style>
	.progress {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: var(--card-gap, 16px);
		align-items: stretch;
	}
	.missing {
		padding: 18px 20px;
		max-width: 60ch;
	}
	.missing h2 {
		margin: 0 0 var(--space-5);
		font-size: var(--text-lg);
		color: var(--fg1);
	}
	.missing p {
		margin: 0 0 var(--space-5);
		font-size: var(--text-md);
		line-height: 1.5;
		color: var(--fg2);
	}
	.command {
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--bd);
		border-radius: var(--radius-ctl);
		background: var(--card2);
		color: var(--fg1);
	}
</style>
