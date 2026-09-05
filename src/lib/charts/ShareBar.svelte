<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * One bar, every share of it in its own colour.
	 *
	 * The first thing a "where did it go" list should say is the proportions,
	 * before any figure is read; this is that, above the list. Shares are
	 * percentages already summed by the caller, so a share of 0 draws nothing
	 * rather than a hairline claiming to be something.
	 */
	let {
		segments,
		height = 12
	}: {
		segments: { key: string; pct: number; colorVar: string; label: string }[];
		height?: number;
	} = $props();

	const summary = $derived(
		segments
			.filter((s) => s.pct > 0)
			.map((s) => `${s.label} ${s.pct}%`)
			.join(', ')
	);
</script>

<div class="share" role="img" aria-label={summary} style:height="{height}px">
	{#each segments as s (s.key)}
		{#if s.pct > 0}
			<span class="seg" style:flex-basis="{s.pct}%" style:background="var({s.colorVar})"></span>
		{/if}
	{/each}
</div>

<style>
	.share {
		display: flex;
		gap: var(--space-1);
		width: 100%;
		border-radius: var(--radius-pill);
		overflow: hidden;
		background: var(--card3);
	}
	.seg {
		display: block;
		flex: 0 0 auto;
		height: 100%;
		min-width: 2px;
	}
</style>
