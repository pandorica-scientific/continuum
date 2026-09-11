<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The world, with the places this household has been in colour.
	 *
	 * Markup and gestures. Every number comes from `projection.ts` and
	 * `labels.ts`, both of which are pure and tested without a browser.
	 *
	 * THE GESTURES ARE SPLIT SO NOTHING COMPETES WITH THE PAGE.
	 * A single tap picks a country and says its name; a double tap opens it.
	 * Nothing here binds the wheel and nothing binds a swipe — a map that eats
	 * the scroll is a map you cannot get past on a phone.
	 */
	import { countryFill, countryColour, type CountryColour } from '$lib/life/geo/country-colour';
	import { COUNTRY_COLOURS } from '$lib/life/geo/country-colour-table';
	import {
		countriesFrom,
		moveCrimea,
		shapesFrom,
		sphereOutline,
		worldProjection,
		VIEW
	} from '$lib/life/map/projection';
	import { FOIL, FOIL_EDGE, foilFor } from '$lib/life/map/materials';
	import type { Topology } from 'topojson-specification';

	interface Props {
		/** The world-atlas topology, as JSON text. */
		world: string;
		/** Outline name → ISO code, from the generated manifest. */
		codeByName: Record<string, string>;
		/** The ISO codes that count as visited under the current filter. */
		visited: Set<string>;
		onopen: (code: string, name: string) => void;
	}

	let { world, codeByName, visited, onopen }: Props = $props();

	/**
	 * Parsed and projected once.
	 *
	 * This is a 756 kB document and about 240 path strings; doing it in a
	 * `$derived` that reads `visited` would redo all of it every time somebody
	 * pressed a member pill.
	 */
	const projected = $derived.by(() => {
		const topology = JSON.parse(world) as Topology;
		const countries = countriesFrom(topology);
		// Before anything is projected: the outline files Crimea under Russia.
		moveCrimea(countries);
		const projection = worldProjection(countries);
		return { shapes: shapesFrom(countries, projection), sphere: sphereOutline(projection) };
	});

	const shapes = $derived(projected.shapes);

	/** Which countries are lit, by outline name rather than by code. */
	const lit = $derived(
		new Set(shapes.filter((shape) => visited.has(codeByName[shape.name] ?? '')).map((s) => s.name))
	);

	const colourOf = (name: string): CountryColour =>
		countryColour(codeByName[name] ?? name.slice(0, 2), COUNTRY_COLOURS);

	const open = (name: string) => onopen(codeByName[name] ?? '', name);

	/**
	 * One click opens a country; a double click zooms the map.
	 *
	 * A double click fires two clicks first, so the open has to wait long enough
	 * to find out which gesture this was. Without the wait, zooming in on Europe
	 * navigates to whichever country was under the pointer.
	 *
	 * The zoom listens on the `<svg>` ALONE and lets the event bubble to it. It
	 * was on the countries as well, and the two handlers ran in turn on one
	 * gesture: the country zoomed in, the bubbled event saw a zoomed map and
	 * zoomed straight back out. Nothing moved, and only the labels — which
	 * counter-scale — showed anything had happened.
	 */
	const DOUBLE_CLICK_MS = 260;
	let pending: ReturnType<typeof setTimeout> | null = null;

	function clearPending() {
		if (pending === null) return;
		clearTimeout(pending);
		pending = null;
	}

	function clickedCountry(name: string) {
		clearPending();
		pending = setTimeout(() => {
			pending = null;
			open(name);
		}, DOUBLE_CLICK_MS);
	}

	/**
	 * Zoom and pan, as the handoff's prototype does it.
	 *
	 * A scale `k` between 1 and 8 with a translate, clamped so the map can never
	 * be dragged off its own frame. Held as a transform on a group rather than a
	 * new `viewBox`: nothing is re-projected, and re-projecting 240 countries on
	 * every wheel notch would stutter on a phone.
	 */
	const MOST = 8;
	let k = $state(1);
	let tx = $state(0);
	let ty = $state(0);

	const transform = $derived(k === 1 ? '' : `translate(${tx} ${ty}) scale(${k})`);

	/** Keep the map covering its frame: no dragging the world off the edge. */
	function clampPan(scale: number, x: number, y: number): [number, number] {
		return [
			Math.min(0, Math.max(VIEW.width - VIEW.width * scale, x)),
			Math.min(0, Math.max(VIEW.height - VIEW.height * scale, y))
		];
	}

	/** Zoom about a point, so what is under the pointer stays under it. */
	function zoomAbout(mx: number, my: number, factor: number) {
		const was = k;
		const now = Math.max(1, Math.min(MOST, was * factor));
		if (now === was) return;
		const [x, y] = clampPan(now, mx - (mx - tx) * (now / was), my - (my - ty) * (now / was));
		k = now;
		tx = x;
		ty = y;
	}

	const reset = () => {
		k = 1;
		tx = 0;
		ty = 0;
	};

	/** Where a pointer event landed, in the map's own coordinates. */
	function worldPoint(event: MouseEvent): [number, number] {
		const box = (event.currentTarget as Element).getBoundingClientRect();
		return [
			((event.clientX - box.left) / box.width) * VIEW.width,
			((event.clientY - box.top) / box.height) * VIEW.height
		];
	}

	// NOTHING BINDS THE WHEEL. The prototype zooms on ⌘/Ctrl-wheel; this does
	// not, because a map inside a scrolling page that reacts to the wheel at all
	// is a map somebody has to fight to scroll past. Double click zooms, and the
	// two buttons below do it without a gesture.

	/** Dragging pans, but only once there is somewhere to pan to. */
	let drag: { x: number; y: number; tx: number; ty: number; moved: number } | null = null;

	function onPointerDown(event: PointerEvent) {
		drag = { x: event.clientX, y: event.clientY, tx, ty, moved: 0 };
	}

	function onPointerMove(event: PointerEvent) {
		if (!drag || k === 1) return;
		const box = (event.currentTarget as Element).getBoundingClientRect();
		const dx = ((event.clientX - drag.x) / box.width) * VIEW.width;
		const dy = ((event.clientY - drag.y) / box.height) * VIEW.height;
		drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
		const [x, y] = clampPan(k, drag.tx + dx, drag.ty + dy);
		tx = x;
		ty = y;
	}

	/** A drag is not a click: opening a country on the end of a pan is a trap. */
	function onPointerUp() {
		if (drag && drag.moved > 3) clearPending();
		drag = null;
	}

	/** Double click zooms in about the point, or all the way back out. */
	function toggleZoom(event: MouseEvent) {
		clearPending();
		if (k > 1) return reset();
		const [mx, my] = worldPoint(event);
		zoomAbout(mx, my, 2.6);
	}
</script>

<!-- Escape lives on the wrapper because zoom is about the map as a whole. Enter
     lives on each country, because opening one is about that country. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="map"
	role="application"
	aria-label="The world, with visited countries in colour"
	onkeydown={(event) => {
		if (event.key === 'Escape') reset();
	}}
>
	<div class="stage">
		<svg
			viewBox="0 0 {VIEW.width} {VIEW.height}"
			aria-hidden="true"
			class:panning={k > 1}
			ondblclick={toggleZoom}
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerUp}
			onpointerleave={onPointerUp}
		>
			<!-- The `transform` ATTRIBUTE, not the CSS property. They take different
		     syntax: SVG's `translate(100 200)` is unitless, and CSS silently drops
		     a `translate()` whose arguments have no units — so setting this
		     through `style:` scaled nothing while the labels, which counter-scale
		     in JavaScript, went on resizing. That is the whole bug. -->
			<g {transform}>
				<!-- The edge of the world under this projection, drawn rather than faked
			     with a border radius: it is the ocean, and it stays right if the
			     projection ever changes again. -->
				<path class="sea" d={projected.sphere}></path>

				{#each shapes as shape (shape.name)}
					<path
						class="country"
						class:lit={lit.has(shape.name)}
						d={shape.path}
						style:--fill={lit.has(shape.name)
							? countryFill(colourOf(shape.name))
							: foilFor(shape.name)}
						style:--edge={lit.has(shape.name) ? 'var(--bg)' : FOIL_EDGE}
						role="button"
						tabindex="0"
						aria-label={shape.name}
						onclick={() => clickedCountry(shape.name)}
						onkeydown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								open(shape.name);
							}
						}}
					></path>
				{/each}
			</g>
		</svg>
	</div>

	<div class="foot">
		<!-- The legend says what the two materials mean. Without it the gold reads
		     as "a country we have not got data for" rather than as a coating. -->
		<p class="key">
			<span class="swatches" aria-hidden="true">
				{#each ['series-r1', 'series-r3', 'series-r5'] as slot (slot)}
					<span class="swatch" style:background="var(--{slot})"></span>
				{/each}
			</span>
			scratched off — each country its own colour
			<span class="swatch foil" aria-hidden="true" style:background={FOIL[0]}></span>
			still under the foil
		</p>
		<p class="says">
			Click a country to open it. Double click to zoom in and out.
			<span class="zoom">
				<button
					class="step"
					type="button"
					aria-label="Zoom out"
					disabled={k <= 1}
					onclick={() => zoomAbout(VIEW.width / 2, VIEW.height / 2, 1 / 1.5)}
				>
					−
				</button>
				<span class="level mono">{k.toFixed(1)}×</span>
				<button
					class="step"
					type="button"
					aria-label="Zoom in"
					disabled={k >= MOST}
					onclick={() => zoomAbout(VIEW.width / 2, VIEW.height / 2, 1.5)}
				>
					+
				</button>
			</span>
		</p>
	</div>
</div>

<style>
	.map {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	/* The labels are positioned against this, and its width is what their
	   `cqw` font size is a share of — the map, not the viewport. */
	.stage {
		position: relative;
		container-type: inline-size;
	}
	svg {
		display: block;
		width: 100%;
		height: auto;
		/* The ocean. Not a card: the map IS the ground here. */
		background: var(--bg);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
	}
	.sea {
		fill: var(--bg);
		stroke: var(--bd);
		stroke-width: 0.8;
	}
	/* Every country is painted with `--fill`: the foil where nobody has been,
	   its own colour where somebody has. The scratch map is the point — a grey
	   country reads as missing data, a gold one reads as not yet scratched. */
	.country {
		fill: var(--fill);
		stroke: var(--edge);
		stroke-width: 0.4;
		cursor: pointer;
	}
	.country:hover {
		stroke: var(--fg3);
		stroke-width: 0.8;
	}
	/* The browser's own ring is the BOUNDING BOX of the path, and the United
	   States' box spans the whole map because Alaska crosses the antimeridian —
	   so clicking it drew a blue rectangle across every other country. On both
	   `:focus` and `:focus-visible`, because a click focuses the path too.
	   Nothing is lost: the rose outline below IS the focus indicator, and it
	   follows the country's actual shape. */
	.country:focus,
	.country:focus-visible {
		outline: none;
	}
	.country:focus-visible {
		stroke: var(--rose);
		stroke-width: 1.6;
	}
	/* One treatment, lit or not.
	   The handoff draws two — white over colour, dark under foil — but the
	   country fills here are already muted 82% into the ground, so the same ink
	   and the same halo carry over both. Inverting on a lit country printed a
	   dark slab over France instead. */
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-6);
		flex-wrap: wrap;
		min-height: var(--control-h, 34px);
	}
	.key,
	.says {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		/* Both may shrink: at a narrow width the legend and the instruction stack
		   rather than the second one running off the edge of the card. */
		min-width: 0;
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.swatches {
		display: inline-flex;
		gap: var(--space-1);
	}
	.swatch {
		display: inline-block;
		width: 11px;
		height: 11px;
		border-radius: 2px;
	}
	.swatch.foil {
		margin-left: var(--space-4);
	}
	/* Grab, not pointer: once the map is zoomed the whole surface drags. */
	svg.panning {
		cursor: grab;
	}
	svg.panning:active {
		cursor: grabbing;
	}
	.zoom {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		margin-left: var(--space-4);
	}
	.step {
		width: 24px;
		height: 24px;
		min-height: auto;
		display: grid;
		place-items: center;
		padding: 0;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-sm);
		background: var(--card);
		color: var(--fg1);
		font-size: var(--text-lg);
		line-height: 1;
	}
	.step:disabled {
		opacity: 0.4;
	}
	.level {
		min-width: 34px;
		text-align: center;
	}
</style>
