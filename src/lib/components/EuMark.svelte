<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// The Union's mark, with a member state's code inside it: twelve gold stars
	// on Reflex Blue, the same convention used on EU ID documents and plates.
	//
	// NOT in `$lib/icons`: that set is one geometry (24 viewBox, no fill,
	// `currentColor`, stroke 1.7), while this is a filled, two-colour emblem
	// that carries text — bending the icon rules around one member isn't right.
	let { code, size = 24 }: { code: string; size?: number } = $props();

	// Reflex Blue and Yellow are specified by the Union and fixed in both
	// themes — not theme tokens, since that would invite reuse as decoration.
	const BLUE = '#003399';
	const GOLD = '#ffcc33';
	// White on Reflex Blue in both themes, as on the plate and licence.
	const INK = '#ffffff';

	// Twelve stars on a circle, drawn as discs pushed to the rim. A five-point
	// star is illegible at this size, so the ring carries the recognition.
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
