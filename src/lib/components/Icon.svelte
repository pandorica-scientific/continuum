<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { ICONS, type IconName, type IconPrimitive } from '$lib/icons';

	let {
		name,
		size = 19,
		label
	}: {
		name: IconName;
		size?: number;
		/** Give this only when the icon carries meaning no nearby text repeats. */
		label?: string;
	} = $props();

	const parts: readonly IconPrimitive[] = $derived(ICONS[name]);
</script>

<!-- The whole set shares one geometry: 24 viewBox, no fill, currentColor
     stroke at 1.7, round caps and joins. Colour comes from the context. -->
<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.7"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : 'presentation'}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	{#each parts as part, i (i)}
		{#if 'path' in part}
			<path d={part.path} />
		{:else if 'circle' in part}
			<circle cx={part.circle[0]} cy={part.circle[1]} r={part.circle[2]} />
		{:else if 'rect' in part}
			<rect
				x={part.rect[0]}
				y={part.rect[1]}
				width={part.rect[2]}
				height={part.rect[3]}
				rx={part.rect[4]}
			/>
		{:else if 'line' in part}
			<line x1={part.line[0]} y1={part.line[1]} x2={part.line[2]} y2={part.line[3]} />
		{/if}
	{/each}
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}
</style>
