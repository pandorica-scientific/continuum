<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * How much of each continent has been opened up.
	 *
	 * One coin per continent, its silhouette under the SAME gold foil as the map
	 * above, with material removed in proportion to how much of it has been
	 * visited. A ring shows the percentage; the figure and the country count sit
	 * BELOW the coin rather than over the ring, which the handoff is explicit
	 * about — a number inside a ring is read as part of the ring.
	 *
	 * The share is of COUNTRIES visited, not of area: a household that has been
	 * to eight European countries has opened up more of Europe than one that
	 * crossed Russia, whatever the square kilometres say.
	 */
	import { geoCentroid, geoMercator, geoNaturalEarth1, geoPath } from 'd3-geo';
	import { FOIL } from '$lib/life/map/materials';
	import type { Geometry } from 'geojson';

	interface Loaded {
		/** ISO code → continent. */
		of: Record<string, string>;
		/** Continent → how many countries are on it. */
		totals: Record<string, number>;
		/** Continent → its countries' outlines. */
		shapes: Record<string, Geometry[]>;
	}

	interface Props {
		/** The ISO codes the household has been to. */
		visited: string[];
		/** Continent → how many countries it has, from the manifest. */
		totals: Record<string, number>;
	}

	let { visited, totals }: Props = $props();

	let loaded = $state<Loaded | null>(null);

	$effect(() => {
		let live = true;
		void (async () => {
			try {
				const response = await fetch('/map/geo/continents');
				if (!response.ok) return;
				const found = (await response.json()) as Loaded;
				if (live) loaded = found;
			} catch {
				// A progress card that does not draw is better than a screen that
				// fails because a decoration could not load.
			}
		})();
		return () => {
			live = false;
		};
	});

	const RING = 2 * Math.PI * 34;

	const coins = $derived.by(() => {
		const found = loaded;
		if (!found) return [];

		const been = new Set(visited.map((code) => code.toUpperCase()));
		const seenPer: Record<string, number> = {};
		for (const [code, continent] of Object.entries(found.of)) {
			if (been.has(code)) seenPer[continent] = (seenPer[continent] ?? 0) + 1;
		}

		return Object.keys(found.shapes)
			.sort()
			.map((continent) => {
				const shapes = found.shapes[continent] ?? [];
				const features = shapes.map((geometry) => ({
					type: 'Feature' as const,
					properties: null,
					geometry
				}));

				/**
				 * The frame is built from the BULK of a continent, not from all of it.
				 *
				 * Natural Earth files transcontinental countries under one continent,
				 * so Russia is in Europe — and fitting Europe to something that
				 * reaches 180°E leaves the part everybody means as an unreadable
				 * smear. Countries far from the middle are dropped from the FIT and
				 * still drawn, which is what an atlas inset does too.
				 */
				const middles = features
					.map((one) => geoCentroid(one as never)[0])
					.filter(Number.isFinite)
					.sort((a, b) => a - b);
				const median = middles[Math.floor(middles.length / 2)] ?? 0;
				const bulk = features.filter((one) => {
					let apart = Math.abs(geoCentroid(one as never)[0] - median);
					if (apart > 180) apart = 360 - apart;
					return apart <= 70;
				});
				const fitTo = {
					type: 'FeatureCollection',
					features: bulk.length > 1 ? bulk : features
				};

				/**
				 * Each continent fitted to its own coin, turned so it is in the
				 * middle first — the coin shows a shape, not a scale, so Oceania is
				 * not a speck beside Asia.
				 *
				 * Mercator for Europe and Africa and Natural Earth for the rest, as
				 * the prototype has it: Europe is small and far north, and Mercator's
				 * stretch towards the poles is exactly what makes it legible at this
				 * size. Everywhere else that stretch is a distortion for nothing.
				 */
				const projection =
					continent === 'Europe' || continent === 'Africa' ? geoMercator() : geoNaturalEarth1();
				const centre = geoCentroid(fitTo as never);
				projection.rotate([-centre[0], 0]).fitExtent(
					[
						[16, 16],
						[68, 68]
					],
					fitTo as never
				);
				const draw = geoPath(projection);
				const path = shapes
					.map((geometry) => draw({ type: 'Feature', properties: null, geometry } as never) ?? '')
					.join(' ');

				const total = totals[continent] ?? found.totals[continent] ?? 0;
				const seen = seenPer[continent] ?? 0;
				const share = total > 0 ? seen / total : 0;

				return { continent, path, seen, total, share, percent: Math.round(share * 100) };
			});
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
					<!-- The ring: how much of this continent has been opened. -->
					<circle class="track" cx="42" cy="42" r="34" />
					<circle
						class="ring"
						cx="42"
						cy="42"
						r="34"
						stroke-dasharray={RING}
						stroke-dashoffset={RING * (1 - coin.share)}
					/>
					<!-- The silhouette, still under foil except for what is opened. -->
					<path class="under" d={coin.path} />
					<path class="foil" d={coin.path} style:fill={FOIL[0]} style:opacity={1 - coin.share} />
				</svg>
				<span class="name">{coin.continent}</span>
				<!-- Below the coin, never over the ring. -->
				<span class="figure">
					<span class="pct display">{coin.percent}</span><span class="unit">%</span>
					<span class="of mono">{coin.seen}/{coin.total}</span>
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
	.track {
		fill: var(--card2);
		stroke: var(--bd);
		stroke-width: 2;
	}
	.ring {
		fill: none;
		stroke: var(--rose);
		stroke-width: 2.4;
		stroke-linecap: round;
		/* From the top, clockwise: a ring that starts at three o'clock reads as
		   rotated to anyone who has seen a progress ring before. */
		transform: rotate(-90deg);
		transform-origin: 42px 42px;
	}
	.under {
		fill: color-mix(in srgb, var(--rose) 42%, var(--bg));
	}
	.name {
		font-size: var(--text-sm);
		color: var(--fg2);
		text-align: center;
	}
	.figure {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-2);
	}
	.pct {
		font-size: var(--display-xs);
		color: var(--fg1);
	}
	.unit,
	.of {
		font-size: var(--text-xs);
		color: var(--fg3);
	}

	@media (max-width: 719px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
