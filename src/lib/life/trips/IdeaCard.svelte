<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Somewhere the household would like to go.
	 *
	 * Fixed width, never stretched: the board is `repeat(auto-fill, 268px)` with
	 * `justify-content: start`, so four cards and five cards are the same size
	 * and the extras wrap. `auto-fit` was tried during design and is wrong —
	 * it stretches a lone card across the whole screen.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import PersonTag from '$lib/components/PersonTag.svelte';
	import { countryFlag } from '$lib/life/geo/countries';

	interface Heart {
		id: string;
		name: string;
		initials: string;
	}

	let {
		name,
		emoji,
		note,
		country,
		hearts,
		hues,
		art,
		makeHref,
		onmake
	}: {
		name: string;
		emoji: string;
		note: string;
		country: string | null;
		hearts: Heart[];
		/** Person id to their `--series-…` token, so a face is the same colour everywhere. */
		hues: Record<string, string>;
		/** The stamp, already inked, or null where the generator could not draw one. */
		art: { svg: string; hue: string | null } | null;
		/**
		 * Where "Make this a trip" goes with no script — a real route, carrying
		 * the idea's id, so the card works in a browser that cannot open a dialog.
		 */
		makeHref: string;
		/** Takes the click when it can, and opens the dialog over the board. */
		onmake: () => void;
	} = $props();
</script>

<article class="idea">
	<!-- A real submit inside the form that wraps this card, so removing an idea
	     works with script switched off. Above the art layer, or the art swallows
	     the pointer — a plain `z-index` in a style string was not enough. -->
	<button class="remove" type="submit" aria-label="Take {name} off the board">
		<Icon name="plus" size={14} />
	</button>

	<div class="art" style:color={art?.hue ? `var(--${art.hue})` : 'var(--fg3)'}>
		{#if art}
			<!-- The one `{@html}` in this product, and it is checked rather than
			     trusted: `assertInertSvg` in $lib/life/art refuses any drawing
			     carrying a script, a handler or an external reference, and the
			     household's own trip name is the only non-machine part of it. -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html art.svg}
		{:else}
			<span class="fallback" aria-hidden="true">{emoji || '📍'}</span>
		{/if}
	</div>

	<div class="body">
		<h3>
			{#if emoji}<span class="emoji" aria-hidden="true">{emoji}</span>{/if}
			<span class="name">{name}</span>
			{#if country}<span class="flag" aria-hidden="true">{countryFlag(country)}</span>{/if}
		</h3>
		{#if note}<p class="note">{note}</p>{/if}

		<div class="foot">
			<div class="hearts">
				{#each hearts as heart (heart.id)}
					<PersonTag name={heart.name} hue={hues[heart.id] ?? '--fg3'} compact />
				{/each}
			</div>
			<a
				class="make"
				href={makeHref}
				onclick={(event) => {
					event.preventDefault();
					onmake();
				}}>Make this a trip</a
			>
		</div>
	</div>
</article>

<style>
	.idea {
		position: relative;
		width: 268px;
		/* Fills whatever the grid row gives it, so a one-line note and a two-line
		   note end at the same edge. `.foot` then floats to the bottom on its
		   `margin-top: auto`. */
		height: 100%;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--card);
		overflow: hidden;
	}
	/* The ✕ rotated into a cross, so the set needs no second glyph for it. */
	.remove {
		position: absolute;
		top: var(--space-4);
		right: var(--space-4);
		z-index: 4;
		width: 26px;
		height: 26px;
		min-height: auto;
		display: grid;
		place-items: center;
		padding: 0;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		background: var(--bg2);
		color: var(--fg3);
		transform: rotate(45deg);
		transition:
			color var(--dur) var(--ease),
			border-color var(--dur) var(--ease),
			background-color var(--dur) var(--ease);
	}
	.remove:hover {
		color: var(--red);
		border-color: color-mix(in srgb, var(--red) 55%, transparent);
		background: color-mix(in srgb, var(--red) 16%, var(--bg2));
	}
	/* A neutral ground, not the area wash.
	   Every stamp is inked in its own colour — its country's, so it matches that
	   country on the map. Behind a rose wash, a green stamp and an amber one
	   both read as a mistake; behind a plain card ground they read as what they
	   are. The wash was the problem, not the ink. */
	.art {
		height: 148px;
		display: grid;
		place-items: center;
		background: var(--card2);
	}
	.art :global(svg) {
		width: 140px;
		height: 140px;
	}
	.fallback {
		font-size: var(--text-4xl);
		opacity: 0.55;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-6) 14px 14px;
		flex: 1;
	}
	h3 {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
	}
	.name {
		min-width: 0;
	}
	.emoji,
	.flag {
		flex: none;
	}
	.note {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.foot {
		margin-top: auto;
		padding-top: var(--space-5);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.hearts {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.make {
		font-size: var(--text-sm);
		color: var(--blue);
	}
	.make:hover {
		text-decoration: underline;
	}
</style>
