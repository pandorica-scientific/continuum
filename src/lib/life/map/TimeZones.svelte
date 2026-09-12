<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Which time zones the household has stood in.
	 *
	 * THE REAL IANA BANDS, not vertical stripes. They follow borders — China is
	 * one zone across five stripes' worth of longitude, and Spain keeps Berlin
	 * time — and drawing them as bars would be a picture of something that does
	 * not exist.
	 *
	 * THE MAP FITS WHOLE. The handoff is explicit: cropping it to fill the card's
	 * height hid the Pacific while the count still included it, which is a card
	 * that lies about its own figure.
	 *
	 * Everything here is already computed. The bands arrive as paths and the
	 * containment test — which country is in which zone — ran on the server: the
	 * zone geometry is a megabyte, and asking a phone to hold it so it can answer
	 * forty point-in-polygon questions is how a card costs a second of scrolling.
	 */
	import { FOIL } from '$lib/life/map/materials';

	interface Band {
		zone: number;
		label: string;
		path: string;
		/** Where its offset is printed: the middle of the band. */
		middle: number;
	}

	interface Props {
		bands: Band[];
		coastline: string;
		/** ISO code → the zone it sits in. */
		zoneOf: Record<string, number>;
		/** The codes counted under the tab currently showing. */
		visited: string[];
		/** How many zones there are altogether. */
		total: number;
	}

	let { bands, coastline, zoneOf, visited, total }: Props = $props();

	const WIDTH = 720;
	const HEIGHT = 360;

	const lit = $derived.by(() => {
		// A plain record rather than a Set: derived and read, never mutated.
		const found: Record<number, true> = {};
		for (const code of visited) {
			const zone = zoneOf[code];
			if (zone !== undefined) found[zone] = true;
		}
		return found;
	});

	const litCount = $derived(Object.keys(lit).length);

	/**
	 * The offsets printed on the map, stacked where they would collide.
	 *
	 * A row is taken until the next label is clear of the last one on it, so a
	 * cluster of European zones reads as two rows rather than as one smear.
	 */
	const marks = $derived.by(() => {
		const rows: number[] = [];
		const HALF = 6.5;
		return bands
			.filter((band) => lit[band.zone])
			.sort((a, b) => a.middle - b.middle)
			.map((band) => {
				const percent = (band.middle / WIDTH) * 100;
				let row = 0;
				while (rows[row] !== undefined && percent - HALF < rows[row]) row++;
				rows[row] = percent + HALF;
				return { zone: band.zone, label: band.label, percent, row };
			});
	});
</script>

<section class="card zones">
	<header>
		<h2>Time zones stood in</h2>
		<span class="count mono">{litCount} of {total || bands.length}</span>
	</header>

	<!-- How far along, before the map. The bar is the figure; the map is where. -->
	<div class="bar" aria-hidden="true">
		<span style:width="{((litCount / Math.max(1, total || bands.length)) * 100).toFixed(1)}%"
		></span>
	</div>

	<div class="stage">
		<!-- Whole, never cropped. -->
		<svg viewBox="0 0 {WIDTH} {HEIGHT}" aria-hidden="true">
			{#each bands as band (band.zone)}
				<path class="band" class:lit={lit[band.zone]} d={band.path} style:--foil={FOIL[0]}></path>
			{/each}
			<path class="land" d={coastline}></path>
		</svg>

		{#each marks as mark (mark.zone)}
			<span
				class="mark mono"
				style:left="clamp(4%, {mark.percent}%, 96%)"
				style:bottom="{5 + mark.row * 18}px"
			>
				{mark.label}
			</span>
		{/each}
	</div>

	<p class="says">A zone lights when a place you scratched off falls inside it. Nothing to tap.</p>
</section>

<style>
	.zones {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
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
	.bar {
		height: 4px;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--rose);
		transition: width 600ms var(--ease, ease);
	}
	.stage {
		position: relative;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		border-radius: var(--radius-ctl);
		background: var(--bg);
	}
	/* Unlit bands are the foil, lit ones the area's own hue — the same two
	   materials as the map above. */
	.band {
		fill: color-mix(in srgb, var(--foil) 46%, transparent);
		stroke: rgba(46, 37, 8, 0.32);
		stroke-width: 0.6;
	}
	.band.lit {
		fill: color-mix(in srgb, var(--rose) 46%, transparent);
		stroke: color-mix(in srgb, var(--rose) 72%, transparent);
	}
	.land {
		fill: none;
		stroke: rgba(255, 255, 255, 0.22);
		stroke-width: 0.5;
	}
	.mark {
		position: absolute;
		transform: translateX(-50%);
		font-size: 8px;
		font-weight: 600;
		line-height: 1.2;
		color: var(--rose);
		white-space: nowrap;
		pointer-events: none;
		text-shadow:
			0 0 4px var(--bg2),
			0 0 3px var(--bg2),
			0 0 2px var(--bg2);
	}
	.says {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}

	@media (prefers-reduced-motion: reduce) {
		.bar span {
			transition: none;
		}
	}
</style>
