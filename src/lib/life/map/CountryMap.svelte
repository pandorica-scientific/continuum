<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * One country, filling the frame, under the same gold coating as the world.
	 * Regions are drawn in colour underneath; scratching reveals it.
	 *
	 * Provinces are fetched on mount rather than shipped with the page —
	 * Russia's outlines alone are 2.2 MB.
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

	/**
	 * The household view is a reading, not a record.
	 *
	 * It is the union of everybody's visits, so it belongs to nobody and there
	 * is no one to credit a new scratch to. Scratching here used to write a
	 * visit with no member at all — a fact about the household that no person's
	 * tab could ever show, and that nothing could later attribute.
	 */
	const readonly = $derived(!who);

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
	 * A different person's map is a different reading, so nothing carries over.
	 *
	 * `scratched` is what this SESSION put on top of what was filed. Left alone
	 * across a tab switch it showed one person's scratches on another's map, and
	 * the undo pill offered to take back a scratch that was never theirs.
	 */
	let shownFor = $state<string | null | undefined>(undefined);
	$effect(() => {
		const now = who ?? null;
		if (untrack(() => shownFor) === now) return;
		shownFor = now;
		scratched = [];
		undoable = null;
		toast = null;
	});

	/** The names the household has been to, matched case-insensitively against Natural Earth's names. */
	const been = $derived(new Set([...visited, ...scratched].map((name) => name.toLowerCase())));

	/** Which regions start with no coating on them. */
	const alreadyClear = $derived(
		(regions ?? [])
			.map((region, index) => (been.has(region.name.toLowerCase()) ? index : -1))
			.filter((index) => index >= 0)
	);

	/**
	 * `slug`/`geoVersion` read through `$derived` rather than the prop directly
	 * — a prop re-reports a change whenever the parent's `data` is replaced
	 * (which `invalidate` does after every scratch), even if the string itself
	 * is unchanged; `$derived` compares and stops here.
	 */
	const which = $derived(slug);
	const build = $derived(geoVersion);

	/**
	 * Fetch and build the province cells — once per country, not once per
	 * load. `untrack` around `country` (which the page's load does rebuild)
	 * keeps this effect from refetching outlines that haven't changed.
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
		// Cleared too — panels belong to the country being left, and leaving
		// them up drew stale inset boxes over the next country's fallback outline.
		insets = [];
		failed = null;

		void (async () => {
			try {
				const response = await fetch(`/map/geo/${slugNow}?v=${encodeURIComponent(buildNow)}`);
				if (!response.ok) throw new Error('Those outlines could not be read.');
				const collection = (await response.json()) as FeatureCollection<Geometry>;
				if (!live) return;
				// Re-fit before drawing: the country and province datasets disagree
				// on where the country ends.
				//
				// Far-flung groups (e.g. Svalbard, the Azores) get their own labelled
				// panel rather than stretching the main frame to hold them. Clustered
				// from the raw features, not a pre-filtered set, so they stay
				// reachable to scratch — dropping them makes them unreachable.
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
					// Its own projection, fitted to its own panel, for legibility.
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
				// Specks first — a hit point resolves to the FIRST cell that
				// contains it, and every speck sits inside a bigger region.
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

	/** The smallest a region is drawn, in frame units — about the smallest an eight-pixel finger drag can hit. */
	const TOUCH_RADIUS = 4;
	const TOUCH_AREA = Math.PI * TOUCH_RADIUS * TOUCH_RADIUS;

	/** A circle, as path data, because that is what a cell's coating is drawn from. */
	const disc = (x: number, y: number, r: number) =>
		`M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;

	/**
	 * Turn the province outlines into drawable, scratchable cells.
	 * `contains` inverts the projection to ask the real geometry rather than a
	 * bounding box.
	 *
	 * A region too small to touch (a pixel across — a Pacific atoll, a capital
	 * district) is drawn as a disc at its middle and answers `contains` as
	 * that disc, rather than being dropped — dropping would make some
	 * countries (Maldives, Seychelles) unscratchable entirely.
	 */
	function cellsFrom(features: Feature<Geometry>[], projection: GeoProjection): Region[] {
		const draw = geoPath(projection);

		return features
			.map((one): Region | null => {
				const drawn = draw(one as never);
				if (!drawn) return null;
				const bounds = draw.bounds(one as never);
				if (!bounds.flat().every(Number.isFinite)) return null;

				// Label sits on the region's biggest piece, not the centroid of all
				// of it — that can fall in the sea between an island and the mainland.
				const main = biggestPiece(one);
				const at = draw.centroid(main as never);
				const mainBounds = draw.bounds(main as never);

				// Projected area, not globe area, since it decides whether a shape can be hit.
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
						// A disc is asked about in frame units, not the real geometry.
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
	 * What to call a province: the trailing type word is dropped (Natural
	 * Earth files "Kanagawa Prefecture" — repeating "Prefecture" fourteen
	 * times on one map says nothing). Crimea/Sevastopol are named plainly.
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
	 * Held so its identity is stable — passed inline it was a new array on
	 * every render, and the scratch layer rebuilds its coating (losing
	 * half-finished scratching) whenever the cells array changes.
	 */
	const cells = $derived((regions ?? []).map((region) => region.cell));

	/**
	 * The same regions, in paint order — the reverse of hit order, since SVG
	 * paints later on top and a speck must be seen but hit first.
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
	 * Record the scratch, then say so. Posted, not just drawn, so it persists
	 * across a reload and counts on the world map and tiles.
	 */
	async function cleared(index: number, name: string) {
		// The layer already refuses the pointer; this is the second lock, for a
		// scratch arriving any other way.
		if (readonly) return;
		scratched = [...scratched, name];
		onscratched?.(name);
		// A region with no name can't be undone either — undo removes a visit by name.
		say(
			name ? `${name} — scratched off.` : 'A region — scratched off. Name it?',
			name ? { index, name } : null
		);

		if (!name) return;
		const body = new FormData();
		body.set('region', name);
		if (who) body.set('who', who);
		// `submitAction`, not a bare fetch — fetch doesn't throw on 400/500, so a
		// refused scratch would otherwise invalidate anyway.
		const outcome = await submitAction('?/scratched', body, { updatePage: false });
		if (outcome.type !== 'success') {
			// The foil is off on screen either way; the next scratch tries again.
			say(`${name} — scratched off, but it could not be saved.`);
			return;
		}
		// Only the visit query, not the whole route — else the page blinks after each scratch.
		await invalidate(VISITS);
	}

	/**
	 * Take the last scratch back: coating restored immediately and
	 * unconditionally (not waiting on the server), then the delete is sent —
	 * if it fails, the pill says so and the next reload has the truth.
	 */
	async function undo() {
		const taking = undoable;
		if (!taking || readonly) return;
		undoable = null;

		layer?.recoat(taking.index);
		scratched = scratched.filter((one) => one !== taking.name);

		const body = new FormData();
		body.set('region', taking.name);
		// Whose scratch is being taken back. Undo removes one person's visit, not
		// the region — two people can have scratched the same one.
		if (who) body.set('who', who);
		const outcome = await submitAction('?/unscratched', body, { updatePage: false });
		if (outcome.type !== 'success') {
			// Roll back the optimistic recoat — the server refused (e.g. a visit
			// a trip wrote) and says why, which the pill then shows.
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
			<!-- Panels first, under everything, so a group sits on its own ground. -->
			<!-- Keyed by position, not label — two far-flung groups can share a
			     name (e.g. Madagascar's offshore islands), and a duplicate key throws. -->
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
				<!-- Whole country while provinces load, so there's a shape to see. -->
				<path class="whole" d={country.path}></path>
			{/if}
		</svg>

		{#if regions}
			<!-- Keyed on the person, so switching tab builds a NEW coating rather
			     than keeping the one already painted. The canvas is the engine's
			     own state and `clear` is read untracked on purpose — an ordinary
			     scratch must not repaint everything — so a different reading has
			     to arrive as a different component, not as a changed prop. -->
			{#key who}
				<ScratchLayer
					bind:this={layer}
					{cells}
					clear={alreadyClear}
					oncleared={cleared}
					{readonly}
				/>
			{/key}
		{/if}

		<!-- Names over the coating: dark on foil, white on a scratched region —
		     same treatment as the world map. -->
		<!-- Keyed by position, not name — Natural Earth reuses province names
		     (e.g. four Madagascan regions named "Antananarivo"). -->
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
		{:else if readonly && regions}
			<span class="mono">{alreadyClear.length}</span>
			of <span class="mono">{regions.length}</span>
			{regions.length === 1 ? 'region' : 'regions'} — everyone's visits together. Pick a person to scratch.
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

	/* Only decorative motion is removed — the scratch itself is the interaction. */
	@media (prefers-reduced-motion: reduce) {
		.toast {
			transition: none;
		}
	}
</style>
