<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	let { size = 22 }: { size?: number } = $props();
</script>

<svg
	viewBox="0 0 56 56"
	style:width="{size}px"
	style:height="{size}px"
	style="flex: 0 0 auto; display: block; color: var(--brand);"
	aria-hidden="true"
>
	<g fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round">
		<path d="M18 18 A10 10 0 0 1 18 38" />
		<path d="M18 10 A18 18 0 0 1 18 46" opacity="0.62" />
		{#if size >= 16}
			<path d="M18 3 A25 25 0 0 1 18 53" opacity="0.34" />
		{/if}
	</g>
	<circle cx="18" cy="28" r="3.6" fill="currentColor" />
</svg>
