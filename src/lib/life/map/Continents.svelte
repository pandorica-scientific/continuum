<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * How much of each continent has been opened up.
	 *
	 * The handoff's card, ported: a dark disc, the continent's silhouette under
	 * gold foil with holes punched where the household has been, and a ring in
	 * THAT CONTINENT'S OWN COLOUR showing the share. The figure and the count sit
	 * below the coin, never over the ring.
	 *
	 * The share is not simply countries visited over countries: small countries
	 * count whole, big ones count by the share of their regions somebody has
	 * actually been to. Having been to Prague is having been to Czechia; having
	 * been to New York is not having been to the United States.
	 */
	import { geoCentroid, geoMercator, geoNaturalEarth1, geoPath, type GeoProjection } from 'd3-geo';
	import { FOIL } from '$lib/life/map/materials';
	import type { Geometry } from 'geojson';

	interface Loaded {
		of: Record<string, string>;
		totals: Record<string, number>;
		shapes: Record<string, { code: string | null; geometry: Geometry }[]>;
	}

	interface Props {
		/** ISO code → how much of it counts, 0 to 1. */
		credits: Record<string, number>;
		/** Continent → how many countries it has, from the manifest. */
		totals: Record<string, number>;
		/** Which build of the geodata this is; see the fetch below. */
		geoVersion: string;
		/** ISO code → square kilometres, for weighting the share. */
		areas: Record<string, number>;
		/** A point inside each visited country, for punching a hole in the foil. */
		places: Record<string, [number, number]>;
	}

	let { credits, totals, areas, places, geoVersion }: Props = $props();

	/** The order and the colours are the handoff's. */
	const ORDER = ['Europe', 'Asia', 'North America', 'South America', 'Africa', 'Oceania'];
	const INK: Record<string, string> = {
		Europe: '--series-savings',
		Asia: '--series-health',
		'North America': '--series-transport',
		'South America': '--series-income',
		Africa: '--series-subscriptions',
		Oceania: '--series-bills'
	};

	const RING = 2 * Math.PI * 34;

	let loaded = $state<Loaded | null>(null);

	$effect(() => {
		let live = true;
		void (async () => {
			try {
				/*
				 * Stamped with the build, because this file is served `immutable`
				 * for a year. v0.9.1 learned that on the country outlines and this
				 * fetch was missed: when the shape list gained a country code per
				 * entry, every browser that had opened the map before kept the old
				 * format and the coins came up empty.
				 */
				const response = await fetch(`/map/geo/continents?v=${encodeURIComponent(geoVersion)}`);
				if (!response.ok) return;
				const found = (await response.json()) as Loaded;
				if (live) loaded = found;
			} catch {
				// A progress card that does not draw beats a screen that fails.
			}
		})();
		return () => {
			live = false;
		};
	});

	/**
	 * Each continent fitted to its own coin.
	 *
	 * Mercator for Europe and Africa and Natural Earth for the rest, turned so
	 * the continent is in the middle first — the prototype's choice, and the
	 * reason Europe is legible at an inch across. Fitted to ALL of it, so nothing
	 * hangs outside the disc.
	 */
	function projectionFor(
		continent: string,
		shapes: { code: string | null; geometry: Geometry }[]
	): GeoProjection {
		const collection = {
			type: 'FeatureCollection',
			features: shapes.map(({ geometry }) => ({ type: 'Feature', properties: null, geometry }))
		};
		const projection =
			continent === 'Europe' || continent === 'Africa' ? geoMercator() : geoNaturalEarth1();
		const centre = geoCentroid(collection as never);
		return projection.rotate([-centre[0], 0]).fitExtent(
			[
				[16, 16],
				[68, 68]
			],
			collection as never
		);
	}

	const coins = $derived.by(() => {
		const found = loaded;
		if (!found) return [];

		return ORDER.filter((continent) => totals[continent] || found.totals[continent]).map(
			(continent) => {
				const shapes = found.shapes[continent] ?? [];
				const projection = projectionFor(continent, shapes);
				const draw = geoPath(projection);

				let sum = 0;
				let whole = 0;
				let count = 0;
				/*
				 * The SHAPE of each country somebody has been to, punched out of the
				 * coating — not a dot at its middle.
				 *
				 * A fixed circle made every country the same size on the coin, which
				 * is only defensible when they are all specks. Australia is half of
				 * the Oceania coin, so having been everywhere in it still looked like
				 * a pinprick on an untouched continent.
				 */
				const holes: string[] = [];
				// A plain record, not a Map: this is a lookup built and thrown away
				// inside one derivation, and a SvelteMap would add reactivity to
				// something nothing reacts to.
				const drawnFor: Record<string, string> = {};
				// ONE pass: the coin's outline and the per-country lookup are the same
				// path data, and projecting every shape of every continent twice to
				// get both was the whole of the second loop this replaces.
				const drawn: string[] = [];
				for (const { code, geometry } of shapes) {
					const d = draw({ type: 'Feature', properties: null, geometry } as never);
					if (!d) continue;
					drawn.push(d);
					if (code) drawnFor[code] = (drawnFor[code] ?? '') + ' ' + d;
				}
				const path = drawn.join(' ');
				for (const [code, credit] of Object.entries(credits)) {
					if (found.of[code] !== continent) continue;
					// Weighted by how big the country is: Australia is seven and a
					// half million square kilometres of Oceania and Nauru is
					// twenty-eight, and counting them equally said otherwise.
					sum += credit * (areas[code] ?? 0);
					count++;
					const outline = drawnFor[code];
					if (outline) {
						holes.push(outline);
						continue;
					}
					// No outline at 110m — an island the coarse file omits. A dot at
					// its centre is the honest fallback: something rather than nothing.
					const at = places[code];
					if (!at) continue;
					const point = projection(at);
					if (point && Number.isFinite(point[0])) {
						holes.push(`M ${point[0] - 2} ${point[1]} a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0`);
					}
				}

				// The denominator is the LAND, not the country list: every country on
				// this continent, whether it has been visited or not.
				for (const [code, where] of Object.entries(found.of)) {
					if (where === continent) whole += areas[code] ?? 0;
				}

				const total = totals[continent] ?? found.totals[continent] ?? 0;
				const covered = whole > 0 ? Math.min(1, sum / whole) : 0;

				/*
				 * A hundred per cent means FINISHED, so it is withheld until every
				 * country has been visited.
				 *
				 * Weighting by land is what the figure should measure, and it has
				 * one edge nobody would accept: Oceania's sixteen smallest
				 * countries are nine thousand square kilometres out of eight and a
				 * half million, so scratching Australia, New Zealand and Papua New
				 * Guinea rounds to a hundred while sixteen countries remain. The
				 * bar filling completely is a promise; this keeps it.
				 */
				const share = count < total ? Math.min(covered, 0.99) : covered;

				return {
					continent,
					path,
					holes,
					count,
					total,
					share,
					ink: `var(${INK[continent] ?? '--series-r1'})`,
					// One decimal below ten per cent, none above: "0.2%" says
					// something where "0%" beside one visited country says nothing.
					percent: `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`
				};
			}
		);
	});
</script>

<section class="card continents">
	<header>
		<h2>Continents opened up</h2>
		<span class="count mono">{coins.length} continents</span>
	</header>

	<div class="grid">
		{#each coins as coin (coin.continent)}
			<div class="coin">
				<svg viewBox="0 0 84 84" aria-hidden="true">
					<defs>
						<!-- Where the household has been, punched out of the coating. -->
						<mask id="coin-{coin.continent.replaceAll(' ', '')}">
							<rect x="0" y="0" width="84" height="84" fill="white" />
							{#each coin.holes as hole, at (at)}
								<path d={hole} fill="black" />
							{/each}
						</mask>
					</defs>

					<circle class="disc" cx="42" cy="42" r="38" />
					<!-- The continent underneath, in its own ink, brightening as it
					     opens up. -->
					<path
						d={coin.path}
						style:fill="color-mix(in srgb, {coin.ink}
						{Math.round(38 + coin.share * 40)}%, var(--bg))"
					/>
					<!-- The foil still on it. -->
					<path
						d={coin.path}
						style:fill={FOIL[0]}
						mask="url(#coin-{coin.continent.replaceAll(' ', '')})"
					/>

					<circle
						class="ring"
						cx="42"
						cy="42"
						r="34"
						style:stroke={coin.ink}
						stroke-dasharray={RING}
						stroke-dashoffset={RING * (1 - coin.share)}
					/>
				</svg>

				<span class="name">{coin.continent}</span>
				<span class="figure">
					<span class="pct mono">{coin.percent}</span>
					<span class="of mono">{coin.count} of {coin.total}</span>
				</span>
			</div>
		{/each}
	</div>

	<p class="says">
		Counted by land: a continent fills as you cover it, so a big country moves it further than a
		small one. Big countries count by the regions you have been to.
	</p>
</section>

<style>
	.continents {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		padding: 14px 16px;
	}
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-5);
	}
	h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
	}
	.count {
		font-size: var(--text-md);
		color: var(--fg3);
		white-space: nowrap;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-8);
		align-content: center;
		justify-items: center;
	}
	.coin {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		min-width: 0;
	}
	svg {
		display: block;
		width: 100%;
		max-width: 132px;
		height: auto;
	}
	.disc {
		fill: var(--bg2);
		stroke: var(--bd2);
		stroke-width: 1;
	}
	.ring {
		fill: none;
		stroke-width: 7;
		stroke-linecap: round;
		/* From the top, clockwise. */
		transform: rotate(-90deg);
		transform-origin: 50% 50%;
		transition: stroke-dashoffset 900ms cubic-bezier(0.2, 0, 0.2, 1);
	}
	.name {
		font-size: var(--text-sm);
		color: var(--fg1);
		text-align: center;
		line-height: 1.25;
	}
	.figure {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
	}
	.pct {
		font-size: var(--text-md);
		font-weight: 600;
		color: var(--fg1);
		white-space: nowrap;
	}
	.of {
		font-size: var(--text-xs);
		color: var(--fg3);
		white-space: nowrap;
	}
	.says {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}

	@media (prefers-reduced-motion: reduce) {
		.ring {
			transition: none;
		}
	}
	@media (max-width: 719px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
