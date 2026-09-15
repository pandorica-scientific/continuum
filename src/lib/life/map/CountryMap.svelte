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
	import { untrack } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { submitAction } from '$lib/actions/result';
	import { countryColour, regionFill } from '$lib/life/geo/country-colour';
	import { COUNTRY_COLOURS } from '$lib/life/geo/country-colour-table';
	import {
		VIEW,
		clusterRegions,
		countriesFrom,
		countryProjection,
		insetBoxes,
		mainExtent,
		moveCrimea,
		type InsetBox
	} from '$lib/life/map/projection';
	import { placeRegionLabels } from '$lib/life/map/labels';
	import { FOIL_HALO, FOIL_INK, SCRATCHED_HALO, SCRATCHED_INK } from '$lib/life/map/materials';
	import ScratchLayer from '$lib/life/map/ScratchLayer.svelte';
	import type { Cell } from '$lib/life/map/foil';
	import { VISITS } from '$lib/life/map/depends';
	import { geoArea, geoContains, geoMercator, geoPath, type GeoProjection } from 'd3-geo';
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
		/** Which build of the outlines to ask for; see the page's own comment. */
		geoVersion: string;
		/** Whose view this is, so the scratch is credited to them. Null is the household. */
		who?: string | null;
		/** Somebody scratched a region through. */
		onscratched?: (name: string) => void;
	}

	let {
		code,
		slug,
		outlineName,
		world,
		visited,
		regionCount,
		geoVersion,
		who = null,
		onscratched
	}: Props = $props();

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
		/** Drawn as a disc because its real outline is too small to hit. */
		speck: boolean;
		/** Where its name goes, and how much room the biggest piece has for it. */
		at: [number, number];
		mainWidth: number;
		mainHeight: number;
	}

	let regions = $state<Region[] | null>(null);
	/** The panels down the left, each holding one far-flung group. */
	let insets = $state<(InsetBox & { label: string })[]>([]);
	let failed = $state<string | null>(null);
	/** Names scratched off in this session, on top of what was already visited. */
	let scratched = $state<string[]>([]);
	let toast = $state<string | null>(null);
	/** The scratch the pill is currently offering to take back, if any. */
	let undoable = $state<{ index: number; name: string } | null>(null);
	let layer = $state<ReturnType<typeof ScratchLayer> | null>(null);

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

	/**
	 * What the provinces are fetched from, held so an unchanged value is not a
	 * change.
	 *
	 * Reading `slug` straight inside the effect below is not enough, and this is
	 * the subtle half of the blink. A prop is a getter onto the parent's `data`,
	 * so it reports a change whenever `data` is replaced — which `invalidate`
	 * does after every scratch — even though the string is the same string. A
	 * `$derived` compares, and a value equal to the last one stops here.
	 */
	const which = $derived(slug);
	const build = $derived(geoVersion);

	/**
	 * Fetch and build the province cells — once per COUNTRY, not once per load.
	 *
	 * The outlines cannot have changed, because the country did not, and
	 * refetching them threw the map back to the grey whole-country fallback and
	 * rebuilt every foil canvas — once per region scratched. Two things keep
	 * this effect still: the deriveds above, and `untrack` around `country`,
	 * which the page's load does rebuild.
	 */
	$effect(() => {
		// Read first, so the effect depends on these and on nothing else.
		const slugNow = which;
		const buildNow = build;
		const projection = untrack(() => country?.projection);
		const outline = untrack(() => country?.feature);
		if (!projection || !outline) return;

		let live = true;
		regions = null;
		// Cleared with them: the panels belong to the country being left, and
		// leaving them up drew Portugal's Azores and Madeira boxes over the grey
		// fallback outline of whatever was opened next until the fetch returned.
		insets = [];
		failed = null;

		void (async () => {
			try {
				const response = await fetch(`/map/geo/${slugNow}?v=${encodeURIComponent(buildNow)}`);
				if (!response.ok) throw new Error('Those outlines could not be read.');
				const collection = (await response.json()) as FeatureCollection<Geometry>;
				if (!live) return;
				// Re-fit before anything is drawn: the country outline and the
				// province outlines are different datasets and disagree about
				// where a country ends, so a frame built from one leaves the
				// other hanging off the edge.
				/*
				 * The far-flung groups get panels of their own rather than dragging
				 * the frame out to hold them. Norway with Svalbard in the same box
				 * is a sliver of coast at the bottom of an empty ocean; Portugal
				 * with the Azores is the same picture. Each group is drawn at its
				 * own scale in a labelled panel, which is what an atlas does and
				 * what keeps every region reachable — there is no other way to
				 * scratch one off.
				 */
				/*
				 * Clustered from the RAW features, not from a pre-filtered set.
				 * `refitToProvinces` used to drop far-flung provinces before the
				 * frame was built, which is what this replaces: dropping them
				 * makes them unreachable, and there is no other way to scratch a
				 * region off. Portugal showed no Azores and no Madeira at all
				 * until the filter came out.
				 */
				const [main = [], ...far] = clusterRegions(collection.features);
				const boxes = insetBoxes(far.length);

				projection.fitExtent(mainExtent(far.length), {
					type: 'FeatureCollection',
					features: main
				} as never);

				const built = cellsFrom(main, projection);
				const panels: (InsetBox & { label: string })[] = [];

				far.forEach((group, at) => {
					const box = boxes[at];
					if (!box) return;
					// Its own projection, fitted to its own panel: the group is drawn
					// at whatever scale makes it legible there, which is the point.
					const inner = geoMercator().fitExtent(
						[
							[box.x + 6, box.y + 16],
							[box.x + box.width - 6, box.y + box.height - 6]
						],
						{ type: 'FeatureCollection', features: group } as never
					);
					built.push(...cellsFrom(group, inner));
					panels.push({ ...box, label: group.map(tidyRegionName).join(' · ') });
				});

				insets = panels;
				/*
				 * Specks first, because a point is resolved to the FIRST cell that
				 * contains it and every one of them sits inside a bigger region:
				 * Jervis Bay is a hole in New South Wales, the District of Columbia
				 * a hole in Maryland. Behind their neighbour in the list they could
				 * never be reached, which is the whole point of drawing them.
				 */
				built.sort((a, b) => Number(b.speck) - Number(a.speck));
				regions = built;
			} catch (error) {
				if (live) failed = error instanceof Error ? error.message : 'Something went wrong.';
			}
		})();

		return () => {
			live = false;
		};
	});

	/**
	 * The smallest a region is allowed to be drawn, in frame units.
	 *
	 * The frame is 960 by 480 and renders at roughly that in CSS pixels, so this
	 * is an eight-pixel disc: about the smallest thing a finger can be dragged
	 * across on purpose.
	 */
	const TOUCH_RADIUS = 4;
	const TOUCH_AREA = Math.PI * TOUCH_RADIUS * TOUCH_RADIUS;

	/** A circle, as path data, because that is what a cell's coating is drawn from. */
	const disc = (x: number, y: number, r: number) =>
		`M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;

	/**
	 * Turn the province outlines into drawable, scratchable cells.
	 *
	 * `contains` inverts the projection and asks the real geometry, which is how
	 * the coverage sampler knows which of its grid points are actually inside a
	 * region rather than merely inside its bounding box.
	 *
	 * ## Specks
	 *
	 * A region whose true outline covers less than a touch is drawn as a disc at
	 * its middle instead, and answers `contains` as that disc. Jervis Bay
	 * Territory is 1.1 square units inside an Australia of four hundred thousand
	 * — a shape a pixel across, which could be seen and could not be scratched,
	 * and the same was true of every atoll in the Maldives, every district of
	 * Seychelles, the District of Columbia, Moscow, Luxor and Chandigarh.
	 *
	 * Drawn rather than dropped. Dropping them was the other way out and it is
	 * worse twice over: Maldives and Seychelles are made of nothing else, so they
	 * would have emptied, and the ones big countries hide are capital cities —
	 * the regions somebody is most likely to have actually been to. An atlas puts
	 * a disc where a shape will not fit, and has done for two centuries.
	 */
	function cellsFrom(features: Feature<Geometry>[], projection: GeoProjection): Region[] {
		const draw = geoPath(projection);

		return features
			.map((one): Region | null => {
				const drawn = draw(one as never);
				if (!drawn) return null;
				const bounds = draw.bounds(one as never);
				if (!bounds.flat().every(Number.isFinite)) return null;

				// The label sits on the region's BIGGEST piece, not on the centroid
				// of all of it: the centroid of a province with an island falls in
				// the sea between them.
				const main = biggestPiece(one);
				const at = draw.centroid(main as never);
				const mainBounds = draw.bounds(main as never);

				// `draw.area` is the projected area, which is the one that decides
				// whether a shape can be hit — the area on the globe cannot, because
				// every country is fitted to the frame at its own scale.
				const speck =
					draw.area(one as never) < TOUCH_AREA && at.every((one) => Number.isFinite(one));

				const [[x0, y0], [x1, y1]] = speck
					? [
							[at[0] - TOUCH_RADIUS, at[1] - TOUCH_RADIUS],
							[at[0] + TOUCH_RADIUS, at[1] + TOUCH_RADIUS]
						]
					: bounds;
				const [[mx0, my0], [mx1, my1]] = speck
					? [
							[at[0] - TOUCH_RADIUS, at[1] - TOUCH_RADIUS],
							[at[0] + TOUCH_RADIUS, at[1] + TOUCH_RADIUS]
						]
					: mainBounds;
				const path = speck ? disc(at[0], at[1], TOUCH_RADIUS) : drawn;

				const name = tidyRegionName(one);
				return {
					name,
					path,
					speck,
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
						// A disc is asked about in frame units. Inverting the
						// projection and asking the real geometry would put the answer
						// back inside the shape nobody can hit.
						contains: speck
							? (x, y) => Math.hypot(x - at[0], y - at[1]) <= TOUCH_RADIUS
							: (x, y) => {
									const point = projection.invert?.([x, y]);
									return point ? geoContains(one as never, point) : false;
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

	/**
	 * Held so its identity is stable.
	 *
	 * Passed inline it was a new array on every render — a toast appearing was
	 * enough — and the scratch layer rebuilds its coating whenever the cells
	 * change, which threw away half-finished scratching.
	 */
	const cells = $derived((regions ?? []).map((region) => region.cell));

	/**
	 * The same regions, in the order they are PAINTED.
	 *
	 * The reverse of the order they are hit in: SVG paints later on top, so a
	 * speck has to come last to be seen, and it has to come first to be reached.
	 * The index travels with it because the fill is picked by position, and
	 * because everything else — the coating, the labels, what a scratch clears —
	 * counts from `regions`.
	 */
	const painted = $derived(
		(regions ?? [])
			.map((region, index) => ({ region, index }))
			.sort((a, b) => Number(a.region.speck) - Number(b.region.speck))
	);

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

	/** How long the pill stays up, and so how long undo is offered for. */
	const UNDO_WINDOW_MS = 5000;

	function say(message: string, offer: { index: number; name: string } | null = null) {
		toast = message;
		undoable = offer;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toast = null;
			undoable = null;
		}, UNDO_WINDOW_MS);
	}

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
		// A region nobody could name cannot be taken back either: undo asks the
		// server to remove a visit BY name, and there is no name to send.
		say(
			name ? `${name} — scratched off.` : 'A region — scratched off. Name it?',
			name ? { index, name } : null
		);

		if (!name) return;
		const body = new FormData();
		body.set('region', name);
		if (who) body.set('who', who);
		// `submitAction` rather than a bare fetch, which is the repo's own helper
		// for exactly this. The bare version only ever noticed a network error:
		// `fetch` does not throw on 400 or 500, so an action that REFUSED the
		// scratch — a missing region, a rejected `who` — went on to invalidate and
		// left "scratched off" on screen for something the server had not kept.
		const outcome = await submitAction('?/scratched', body, { updatePage: false });
		if (outcome.type !== 'success') {
			// The foil is off on screen either way; the next scratch tries again.
			say(`${name} — scratched off, but it could not be saved.`);
			return;
		}
		// Only the visit query, not every load on the route: reloading the layout
		// as well is what made the page blink after each scratch.
		await invalidate(VISITS);
	}

	/**
	 * Take the last scratch back: coating on, visit gone.
	 *
	 * The coating goes back first and unconditionally. A scratch is a gesture
	 * somebody just made and undid on purpose, so the screen must obey
	 * immediately rather than wait to hear whether a delete succeeded — and if it
	 * did not, the pill says so and the next reload has the truth.
	 */
	async function undo() {
		const taking = undoable;
		if (!taking) return;
		undoable = null;

		layer?.recoat(taking.index);
		scratched = scratched.filter((one) => one !== taking.name);

		const body = new FormData();
		body.set('region', taking.name);
		const outcome = await submitAction('?/unscratched', body, { updatePage: false });
		if (outcome.type !== 'success') {
			// Put the screen back where the server says it is rather than leaving a
			// recoated region over a visit that is still recorded. The server
			// refuses an undo it cannot carry out — a visit a trip wrote — and says
			// why, so that reason is what the pill shows.
			layer?.uncoat(taking.index);
			scratched = [...scratched, taking.name];
			say(`${taking.name} — ${outcome.message}`);
			return;
		}
		await invalidate(VISITS);
		say(`${taking.name} — put back.`);
	}
</script>

<div class="country">
	<div class="stage">
		<svg viewBox="0 0 {VIEW.width} {VIEW.height}" aria-hidden="true">
			<!--
				The panels first, under everything, so a group drawn inside one sits
				on its own ground rather than on the sea.
			-->
			<!--
				Keyed by position, not by label: two far-flung groups can carry the
				same name — Madagascar has more than one offshore island filed under
				the same province — and a duplicate key throws rather than renders,
				which is why that country hung on "reading the province outlines".
			-->
			{#each insets as panel, at (at)}
				<rect class="panel" x={panel.x} y={panel.y} width={panel.width} height={panel.height} rx="6"
				></rect>
				<text class="panel-name" x={panel.x + 7} y={panel.y + 12}>{panel.label}</text>
			{/each}

			{#if regions}
				{#each painted as { region, index } (region.name + index)}
					<path class="region" d={region.path} style:--fill={regionFill(colour, index)}></path>
				{/each}
			{:else if country}
				<!-- The whole country while its provinces are on the way, so the shape
				     is there to look at rather than an empty box. -->
				<path class="whole" d={country.path}></path>
			{/if}
		</svg>

		{#if regions}
			<ScratchLayer bind:this={layer} {cells} clear={alreadyClear} oncleared={cleared} />
		{/if}

		<!-- The names sit over the coating, dark on foil and white on a region
		     that has been scratched — the same two treatments as the world map,
		     because they are the same two materials. -->
		<!--
			Keyed by position, not by name. Natural Earth files four separate
			Madagascan regions as "Antananarivo" and three as "Toamasina", so a
			name is not unique — and a duplicate key throws before anything
			renders, which is why that country sat for ever on "reading the
			province outlines".
		-->
		{#each labels as label, at (at)}
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
			<p class="toast" role="status">
				<span>{toast}</span>
				{#if undoable}
					<button type="button" class="undo" onclick={undo}>Undo</button>
				{/if}
			</p>
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
			{regions.length === 1 ? 'region' : 'regions'} scratched off.
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
	/* An inset's ground: enough to read as a panel, not enough to compete with
	   the country in it. */
	.panel {
		fill: color-mix(in srgb, var(--fg1) 4%, transparent);
		stroke: var(--bd2);
		stroke-width: 0.8;
	}
	.panel-name {
		fill: var(--fg3);
		font-size: 9px;
		font-weight: 600;
	}
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
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	/* A link rather than a button shape: the pill is already a small floating
	   object, and a second bordered box inside it reads as a dialog. */
	.undo {
		padding: 0;
		border: 0;
		background: none;
		color: var(--brand);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.undo:hover {
		color: var(--fg1);
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
