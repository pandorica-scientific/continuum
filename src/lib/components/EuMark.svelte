<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	//
	// The Union's mark, with a member state's code inside it.
	//
	// The convention every EU identity document, driving licence and number
	// plate already uses: twelve gold stars on Reflex Blue, the two-letter code
	// in the middle. A reader who has held one of these recognises the ring
	// before they read the letters, which is more than a bare `CZ` ever does.
	//
	// NOT in `$lib/icons`. That set is one geometry — 24 viewBox, no fill,
	// `currentColor`, stroke 1.7 — and this is an emblem rather than an icon: it
	// is filled, it is two specified colours, and it carries text. Adding it
	// there would mean either bending the icon rules around one member or
	// drawing the stars in outline, which is not the mark.
	let { code, size = 24 }: { code: string; size?: number } = $props();

	/**
	 * The emblem's own colours, and the second place in this repository where a
	 * colour is written rather than taken from a token.
	 *
	 * Reflex Blue and Yellow are specified by the Union, the same in both
	 * themes and in print, and are no more a theme colour than the red of a
	 * Czech flag is. A token for them would invite them to be reused as
	 * decoration, which is exactly what an emblem may not be.
	 */
	const BLUE = '#003399';
	const GOLD = '#ffcc33';
	// The letters, which are part of the mark rather than text on a page: white
	// on Reflex Blue in both themes, because the plate and the licence are.
	const INK = '#ffffff';

	// Twelve stars on a circle, drawn as discs and pushed out to the rim.
	//
	// A five-pointed star is four grey pixels at this size, so the ring is what
	// carries the recognition rather than the shape of any one star; and the
	// letters have to win the middle, because a mark that says only "EU" leaves
	// the reader wondering which country the card is from.
	const STARS = Array.from({ length: 12 }, (_, i) => {
		const angle = ((-90 + i * 30) * Math.PI) / 180;
		return { x: 50 + Math.cos(angle) * 41, y: 50 + Math.sin(angle) * 41 };
	});
</script>

<svg
	class="eu"
	viewBox="0 0 100 100"
	width={size}
	height={size}
	role="img"
	aria-label="{code}, European Union"
>
	<circle cx="50" cy="50" r="50" fill={BLUE} />
	{#each STARS as star, i (i)}
		<circle cx={star.x} cy={star.y} r="4" fill={GOLD} />
	{/each}
	<text
		x="50"
		y="50"
		fill={INK}
		font-size="46"
		font-weight="700"
		letter-spacing="1"
		text-anchor="middle"
		dominant-baseline="central">{code}</text
	>
</svg>

<style>
	.eu {
		display: block;
		flex: none;
	}
	text {
		font-family: var(--font-mono);
	}
</style>
