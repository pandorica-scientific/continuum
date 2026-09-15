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

	interface Heart {
		id: string;
		name: string;
		initials: string;
	}

	let {
		name,
		emoji,
		note,
		hearts,
		hues,
		art,
		makeHref,
		onmake
	}: {
		name: string;
		emoji: string;
		note: string;
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

<!--
	The stamp's ink, carried by the whole card.

	Every stamp is inked in its country's colour — the same colour that country
	wears on the map — and the card is washed and edged in it rather than sitting
	in a neutral box. Four ideas then read as four different places at a glance,
	which is what the board is for; in one grey it was the drawing alone doing
	that work.
-->
<article class="idea" style:--ink={art?.hue ? `var(--${art.hue})` : 'var(--fg3)'}>
	<!-- A real submit inside the form that wraps this card, so removing an idea
	     works with script switched off. Above the art layer, or the art swallows
	     the pointer — a plain `z-index` in a style string was not enough. -->
	<button class="remove" type="submit" aria-label="Take {name} off the board">
		<Icon name="plus" size={14} />
	</button>

	<div class="art">
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
		<!-- The name alone. The stamp above prints the country's own code on its
		     rule, so a flag beside the title said the same thing twice, and the
		     emoji was a third copy of the picture already filling half the card. -->
		<h3>{name}</h3>
		{#if note}<p class="note">{note}</p>{/if}

		<div class="foot">
			<div class="hearts">
				{#each hearts as heart (heart.id)}
					<!-- Initials in a disc rather than a named pill: two or three of
					     these sit beside the button on a 268px card, and the full names
					     wrapped the row onto a second line. The name is still on the
					     element for anything that reads it aloud or hovers it. -->
					<span
						class="heart"
						style:--tag={`var(${hues[heart.id] ?? '--fg3'})`}
						title={heart.name}
						aria-label={heart.name}>{heart.initials}</span
					>
				{/each}
			</div>
			<a
				class="btn btn-primary make"
				href={makeHref}
				onclick={(event) => {
					event.preventDefault();
					onmake();
				}}>Make a trip</a
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
		/* A raised box in the stamp's own ink, rather than the flat `--card` the
		   rest of the app uses. An idea is the one thing on this screen that is
		   not a record yet — it sits on the board waiting to be picked up — and
		   at `--card`'s 3% lift the box was invisible against the page.
		   The wash is mixed INTO `--surface-2` rather than laid over it, so the
		   card keeps the same lift off the page in both themes and only its hue
		   changes; and it is kept to 6%, because the thing that has to stay
		   readable on it is ordinary body text — at 9% the note under the title
		   fell below AA on the light theme against the red and purple inks. The
		   border carries the colour instead, where nothing has to be read. */
		border: 1px solid color-mix(in srgb, var(--ink) 45%, var(--bd2));
		border-radius: var(--radius-card);
		background: color-mix(in srgb, var(--ink) 6%, var(--surface-2));
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}
	/* The ✕ rotated into a cross, so the set needs no second glyph for it. */
	.remove {
		position: absolute;
		top: var(--space-4);
		right: var(--space-4);
		z-index: 4;
		width: 28px;
		height: 28px;
		min-height: auto;
		display: grid;
		place-items: center;
		padding: 0;
		border: 1px solid var(--bd2);
		/* A rounded square rather than a circle: it is chrome on the card, not a
		   face on it, and the discs down in the foot are the round things here. */
		border-radius: var(--radius-ctl);
		/* A step above the card it sits on, not the page colour: on the raised
		   card `--bg2` read as a hole punched through it. Carries a little of the
		   same ink, or it reads as a grey sticker left on a coloured card. */
		background: color-mix(in srgb, var(--ink) 9%, var(--surface-3));
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
		background: color-mix(in srgb, var(--red) 16%, var(--surface-3));
	}
	/* No ground of its own — the card is already wearing this ink.
	   A panel behind the stamp cut the card into two halves and made the drawing
	   look like a photograph in a slot; on the card's own ground it reads as what
	   it is, which is a stamp pressed onto the card. */
	.art {
		height: 148px;
		display: grid;
		place-items: center;
		color: var(--ink);
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
		min-width: 0;
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
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
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	/* The person's own colour, from `personHues`, so a face is the same colour
	   here as on Salary and Tax. The ring and the wash carry it at full strength;
	   the initials are darkened towards the theme's ink, because the raw
	   `--series-…` tokens were measured as chart fills and do not clear AA as
	   lettering this small. Carried further than `PersonTag`'s 70% because this
	   wash is denser: at 70% the greens measured 4.3:1 on the light theme. */
	.heart {
		width: 34px;
		height: 34px;
		display: grid;
		place-items: center;
		border: 1px solid color-mix(in srgb, var(--tag) 55%, transparent);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--tag) 16%, transparent);
		color: color-mix(in srgb, var(--tag) 58%, var(--fg1));
		font-size: var(--text-xs);
		font-weight: 600;
	}
	.make {
		/* Not the control height: this button sits on a card rather than in a row
		   of fields, and the 36px floor left it overpowering a 268px card. */
		min-height: auto;
		padding: var(--space-3) 12px;
		font-size: var(--text-sm);
		white-space: normal;
	}
</style>
