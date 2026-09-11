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
	 */
	import { geoEquirectangular, geoContains, geoPath } from 'd3-geo';
	import type { Feature, Geometry } from 'geojson';

	interface Zone {
		zone: number;
		utc: string;
		geometry: Geometry[];
	}

	interface Props {
		/** Where the household has been, as [longitude, latitude]. */
		places: [number, number][];
		/** How many zones there are altogether, from the manifest. */
		total: number;
	}

	let { places, total }: Props = $props();

	let zones = $state<Zone[] | null>(null);

	$effect(() => {
		let live = true;
		void (async () => {
			try {
				const response = await fetch('/map/geo/zones');
				if (!response.ok) return;
				const loaded = (await response.json()) as Zone[];
				if (live) zones = loaded;
			} catch {
				// The card simply does not draw. It is a progress card, not a
				// screen somebody is waiting on.
			}
		})();
		return () => {
			live = false;
		};
	});

	/** A small equirectangular world: the projection zone bands are drawn in. */
	const projection = geoEquirectangular().fitSize([720, 360], { type: 'Sphere' } as never);
	const draw = geoPath(projection);

	const bands = $derived(
		(zones ?? []).map((zone) => {
			const features: Feature<Geometry>[] = zone.geometry.map((geometry) => ({
				type: 'Feature',
				properties: null,
				geometry
			}));
			return {
				zone: zone.zone,
				utc: zone.utc,
				path: features.map((one) => draw(one as never) ?? '').join(' '),
				features
			};
		})
	);

	/**
	 * A zone lights when somewhere scratched off falls inside it.
	 *
	 * Asked of the real geometry rather than of the longitude: a place at 8°E is
	 * in Berlin time, and a place at 8°W is not in the zone a bar chart would
	 * put it in.
	 */
	const lit = $derived.by(() => {
		// A plain record rather than a Set: this is derived and read, never
		// mutated after it is built, and `svelte/prefer-svelte-reactivity` is
		// right that a bare Set held in a component is usually a bug waiting.
		const found: Record<number, true> = {};
		for (const place of places) {
			for (const band of bands) {
				if (found[band.zone]) continue;
				if (band.features.some((one) => geoContains(one as never, place))) found[band.zone] = true;
			}
		}
		return found;
	});

	const litCount = $derived(Object.keys(lit).length);
	const stood = $derived(bands.filter((band) => lit[band.zone]));
</script>

<section class="card zones">
	<header>
		<h2>Time zones stood in</h2>
		<span class="count mono">{litCount} of {total || bands.length}</span>
	</header>

	<!-- Whole, never cropped. -->
	<svg viewBox="0 0 720 360" aria-hidden="true">
		{#each bands as band (band.zone)}
			<path class="band" class:lit={lit[band.zone]} d={band.path}></path>
		{/each}
	</svg>

	{#if stood.length}
		<div class="chips">
			{#each stood as band (band.zone)}
				<span class="chip mono">{band.utc || `UTC${band.zone >= 0 ? '+' : ''}${band.zone}`}</span>
			{/each}
		</div>
	{/if}

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
	svg {
		display: block;
		width: 100%;
		height: auto;
		border-radius: var(--radius-ctl);
		background: var(--bg);
	}
	.band {
		fill: var(--surface-2);
		stroke: var(--bg);
		stroke-width: 0.6;
	}
	.band.lit {
		fill: var(--rose-tint);
		stroke: color-mix(in srgb, var(--rose) 50%, transparent);
	}
	/* Pinned to the foot of the card, as the handoff draws them. */
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: auto;
	}
	.chip {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-pill);
		background: var(--rose-tint);
		color: var(--rose);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.says {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
