<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * How much of each continent has been opened up: a dark disc, the
	 * continent's silhouette under gold foil punched through where the
	 * household has been, and a ring in the continent's own colour for the share.
	 *
	 * The share isn't countries visited over countries — small countries count
	 * whole, big ones by the share of their regions actually visited. Having
	 * been to Prague is having been to Czechia; New York is not the whole US.
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
				// Stamped with the build — this file is served `immutable` for a
				// year, so a schema change needs a new URL to reach cached browsers.
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
	 * Each continent fitted to its own coin. Mercator for Europe/Africa,
	 * Natural Earth for the rest, rotated to centre the continent first.
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
				// The SHAPE of each visited country, punched out of the coating —
				// not a dot at its middle (Australia is half the Oceania coin, so a
				// fixed circle would understate it badly).
				const holes: string[] = [];
				// A plain record, not a Map: built and thrown away inside one
				// derivation, so reactivity would be wasted.
				const drawnFor: Record<string, string> = {};
				// One pass: the coin outline and per-country lookup share the same path data.
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
					// Weighted by country size — counting Nauru equal to Australia would be wrong.
					sum += credit * (areas[code] ?? 0);
					count++;
					const outline = drawnFor[code];
					if (outline) {
						holes.push(outline);
						continue;
					}
					// No outline at 110m resolution — dot at its centre as a fallback.
					const at = places[code];
					if (!at) continue;
					const point = projection(at);
					if (point && Number.isFinite(point[0])) {
						holes.push(`M ${point[0] - 2} ${point[1]} a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0`);
					}
				}

				// Denominator is land area, not country count — visited or not.
				for (const [code, where] of Object.entries(found.of)) {
					if (where === continent) whole += areas[code] ?? 0;
				}

				const total = totals[continent] ?? found.totals[continent] ?? 0;
				const covered = whole > 0 ? Math.min(1, sum / whole) : 0;

				// 100% means every country is visited, not just the land area — else
				// Oceania could round to 100% after just its three biggest countries.
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
