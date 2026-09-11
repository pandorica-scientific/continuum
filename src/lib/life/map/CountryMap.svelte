<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * One country, filling the frame, under the same gold coating as the world.
	 *
	 * The regions are drawn in colour underneath and the foil goes over the top;
	 * scratching a region takes its coating off and reveals the colour that was
	 * always there. Before this the country view had no coating at all, which
	 * made opening a country the one place in the area where the scratch map
	 * stopped being a scratch map.
	 *
	 * The provinces are fetched when this mounts rather than shipped with the
	 * page: Russia's outlines are 2.2 MB and nobody opening the world map wants
	 * to pay for them.
	 */
	import { invalidateAll } from '$app/navigation';
	import { countryColour, regionFill } from '$lib/life/geo/country-colour';
	import { COUNTRY_COLOURS } from '$lib/life/geo/country-colour-table';
	import {
		VIEW,
		countriesFrom,
		countryProjection,
		moveCrimea,
		refitToProvinces
	} from '$lib/life/map/projection';
	import { placeRegionLabels } from '$lib/life/map/labels';
	import { FOIL_HALO, FOIL_INK, SCRATCHED_HALO, SCRATCHED_INK } from '$lib/life/map/materials';
	import ScratchLayer from '$lib/life/map/ScratchLayer.svelte';
	import type { Cell } from '$lib/life/map/foil';
	import { geoArea, geoContains, geoPath, type GeoProjection } from 'd3-geo';
	import type { Feature, FeatureCollection, Geometry } from 'geojson';
	import type { Topology } from 'topojson-specification';

	interface Props {
		code: string;
		/** The filename stem the outlines are served under. NOT the country code. */
		slug: string;
		/** The name the world outline files this country under. */
		outlineName: string;
		/** The world-atlas topology, as JSON text. */
		world: string;
		/** Region names the household has been to. */
		visited: string[];
		/** How many provinces there are to load, for the waiting line. */
		regionCount: number;
		/** Somebody scratched a region through. */
		onscratched?: (name: string) => void;
	}

	let { code, slug, outlineName, world, visited, regionCount, onscratched }: Props = $props();

	const colour = $derived(countryColour(code, COUNTRY_COLOURS));

	/** The country's own outline, re-fitted so it fills the frame. */
	const country = $derived.by(() => {
		const countries = countriesFrom(JSON.parse(world) as Topology);
		moveCrimea(countries);
		const found = countries.features.find(
			(one) => (one.properties as { name?: string } | null)?.name === outlineName
		);
		if (!found) return null;

		const projection = countryProjection(found);
		return { projection, feature: found, path: geoPath(projection)(found) ?? '' };
	});

	interface Region {
		name: string;
		path: string;
		cell: Cell;
		/** Where its name goes, and how much room the biggest piece has for it. */
		at: [number, number];
		mainWidth: number;
		mainHeight: number;
	}

	let regions = $state<Region[] | null>(null);
	let failed = $state<string | null>(null);
	/** Names scratched off in this session, on top of what was already visited. */
	let scratched = $state<string[]>([]);
	let toast = $state<string | null>(null);

	/**
	 * The names the household has been to, matched case-insensitively.
	 *
	 * Exact matching is all this can honestly do against Natural Earth's own
	 * province names — which is why scratching is the better source of truth:
	 * it writes the name the map actually uses.
	 */
	const been = $derived(new Set([...visited, ...scratched].map((name) => name.toLowerCase())));

	/** Which regions start with no coating on them. */
	const alreadyClear = $derived(
		(regions ?? [])
			.map((region, index) => (been.has(region.name.toLowerCase()) ? index : -1))
			.filter((index) => index >= 0)
	);

	$effect(() => {
		const projection = country?.projection;
		if (!projection) return;

		let live = true;
		regions = null;
		failed = null;

		void (async () => {
			try {
				const response = await fetch(`/map/geo/${slug}`);
				if (!response.ok) throw new Error('Those outlines could not be read.');
				const collection = (await response.json()) as FeatureCollection<Geometry>;
				if (!live) return;
				// Re-fit before anything is drawn: the country outline and the
				// province outlines are different datasets and disagree about
				// where a country ends, so a frame built from one leaves the
				// other hanging off the edge.
				const parts = refitToProvinces(projection, country.feature, collection.features);
				regions = cellsFrom(parts, projection);
			} catch (error) {
				if (live) failed = error instanceof Error ? error.message : 'Something went wrong.';
			}
		})();

		return () => {
			live = false;
		};
	});

	/**
	 * Turn the province outlines into drawable, scratchable cells.
	 *
	 * `contains` inverts the projection and asks the real geometry, which is how
	 * the coverage sampler knows which of its grid points are actually inside a
	 * region rather than merely inside its bounding box.
	 */
	function cellsFrom(features: Feature<Geometry>[], projection: GeoProjection): Region[] {
		const draw = geoPath(projection);

		return features
			.map((one): Region | null => {
				const path = draw(one as never);
				if (!path) return null;
				const [[x0, y0], [x1, y1]] = draw.bounds(one as never);
				if (![x0, y0, x1, y1].every(Number.isFinite)) return null;

				// The label sits on the region's BIGGEST piece, not on the centroid
				// of all of it: the centroid of a province with an island falls in
				// the sea between them.
				const main = biggestPiece(one);
				const at = draw.centroid(main as never);
				const [[mx0, my0], [mx1, my1]] = draw.bounds(main as never);

				const name = tidyRegionName(one);
				return {
					name,
					path,
					at: [at[0], at[1]],
					mainWidth: mx1 - mx0,
					mainHeight: my1 - my0,
					cell: {
						d: path,
						name,
						bounds: [
							[x0, y0],
							[x1, y1]
						],
						contains: (x, y) => {
							const at = projection.invert?.([x, y]);
							return at ? geoContains(one as never, at) : false;
						}
					}
				};
			})
			.filter((region): region is Region => region !== null);
	}

	/**
	 * What to call a province.
	 *
	 * The trailing type word goes: Natural Earth files "Porto Province" and
	 * "Kanagawa Prefecture", and a map of Japan reading "… Prefecture" fourteen
	 * times says nothing fourteen times. Crimea and Sevastopol are named the way
	 * a person would, as the handoff's prototype does.
	 */
	const CRIMEAN: Record<string, string> = {
		'Autonomous Republic of Crimea': 'Crimea',
		'Respublika Krym': 'Crimea',
		Krym: 'Crimea',
		"Sevastopol'": 'Sevastopol'
	};

	function tidyRegionName(feature: Feature<Geometry>): string {
		const properties = (feature.properties ?? {}) as { name?: string; name_en?: string };
		const raw = properties.name_en || properties.name || '';
		return (CRIMEAN[raw] ?? raw).replace(
			/\s+(Prefecture|Province|Governorate|Department|District|Municipality|County|Metropolitan City|Autonomous Region|Voivodeship|Oblast|Krai|Region)$/i,
			''
		);
	}

	/** The biggest single piece of a region, for placing its name. */
	function biggestPiece(feature: Feature<Geometry>): Feature<Geometry> {
		if (feature.geometry?.type !== 'MultiPolygon') return feature;
		let best: number[][][] | null = null;
		let biggest = -Infinity;
		for (const coordinates of feature.geometry.coordinates) {
			const area = geoArea({ type: 'Polygon', coordinates } as never);
			if (area > biggest) {
				biggest = area;
				best = coordinates;
			}
		}
		return best
			? {
					type: 'Feature',
					properties: feature.properties,
					geometry: { type: 'Polygon', coordinates: best }
				}
			: feature;
	}

	const labels = $derived(
		placeRegionLabels(
			(regions ?? []).map((region) => ({
				name: region.name,
				x: region.at[0],
				y: region.at[1],
				mainWidth: region.mainWidth,
				mainHeight: region.mainHeight,
				scratched: been.has(region.name.toLowerCase())
			}))
		)
	);

	let toastTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Record the scratch, then say so.
	 *
	 * Posted rather than only drawn: a scratch that changed nothing but a canvas
	 * was a drawing. This is what makes the country colour in on the world map,
	 * the tiles count it, and the foil stay off after a reload.
	 */
	async function cleared(index: number, name: string) {
		scratched = [...scratched, name];
		onscratched?.(name);
		toast = name ? `${name} — scratched off.` : 'A region — scratched off. Name it?';
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toast = null), 4000);

		if (!name) return;
		try {
			const body = new FormData();
			body.set('region', name);
			await fetch('?/scratched', { method: 'POST', body });
			// The world map and the tiles read the same query this page does, so
			// they are right again the moment the server knows.
			await invalidateAll();
		} catch {
			// The foil is off on screen either way; the next scratch tries again.
			toast = `${name} — scratched off, but it could not be saved.`;
		}
	}
</script>

<div class="country">
	<div class="stage">
		<svg viewBox="0 0 {VIEW.width} {VIEW.height}" aria-hidden="true">
			{#if regions}
				{#each regions as region, index (region.name + index)}
					<path class="region" d={region.path} style:--fill={regionFill(colour, index)}></path>
				{/each}
			{:else if country}
				<!-- The whole country while its provinces are on the way, so the shape
				     is there to look at rather than an empty box. -->
				<path class="whole" d={country.path}></path>
			{/if}
		</svg>

		{#if regions}
			<ScratchLayer
				cells={regions.map((region) => region.cell)}
				clear={alreadyClear}
				oncleared={cleared}
			/>
		{/if}

		<!-- The names sit over the coating, dark on foil and white on a region
		     that has been scratched — the same two treatments as the world map,
		     because they are the same two materials. -->
		{#each labels as label (label.name)}
			<span
				class="label"
				class:scratched={been.has(label.name.toLowerCase())}
				style:left="{(label.x / VIEW.width) * 100}%"
				style:top="{(label.y / VIEW.height) * 100}%"
				style:--foil-ink={FOIL_INK}
				style:--foil-halo={FOIL_HALO}
				style:--scratched-ink={SCRATCHED_INK}
				style:--scratched-halo={SCRATCHED_HALO}
			>
				{label.text}
			</span>
		{/each}

		{#if toast}
			<p class="toast" role="status">{toast}</p>
		{/if}
	</div>

	<p class="status">
		{#if failed}
			<span class="failed">{failed}</span>
		{:else if !regions}
			Reading the province outlines{regionCount ? ` — ${regionCount} of them` : ''}…
		{:else}
			<span class="mono">{alreadyClear.length}</span>
			of <span class="mono">{regions.length}</span>
			{regions.length === 1 ? 'region' : 'regions'} scratched off — drag across one to take the foil off.
		{/if}
	</p>
</div>

<style>
	.country {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.stage {
		position: relative;
		/* A container, so a label's `cqw` size is a share of the map. */
		container-type: inline-size;
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--bg);
		overflow: hidden;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
	}
	/* The colour underneath. It is always there; the foil is what hides it. */
	.region {
		fill: var(--fill);
		stroke: var(--bg);
		stroke-width: 0.5;
	}
	.whole {
		fill: var(--surface-2);
		stroke: var(--bd2);
		stroke-width: 0.6;
	}
	.label {
		position: absolute;
		transform: translate(-50%, -50%);
		white-space: pre-line;
		text-align: center;
		pointer-events: none;
		font-size: clamp(8px, 0.82cqw, 13px);
		font-weight: 600;
		line-height: 1.15;
		color: var(--foil-ink);
		text-shadow: var(--foil-halo);
	}
	.label.scratched {
		color: var(--scratched-ink);
		text-shadow: var(--scratched-halo);
	}
	.toast {
		position: absolute;
		left: 50%;
		bottom: var(--space-6);
		transform: translateX(-50%);
		margin: 0;
		padding: var(--space-3) var(--space-6);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		/* Opaque: this floats over a canvas, and `--card` is translucent in the
		   dark theme. */
		background: var(--bg2);
		color: var(--fg1);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.status {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.failed {
		color: var(--red);
	}

	/* The residue and the frame loop go; the scratch itself stays. It is the
	   interaction, not decoration. */
	@media (prefers-reduced-motion: reduce) {
		.toast {
			transition: none;
		}
	}
</style>
