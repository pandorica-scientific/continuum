<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';
	import IconTile from '$lib/components/IconTile.svelte';
	import type { IconName } from '$lib/icons';

	let {
		title,
		icon,
		hue = '--fg3',
		sub = null,
		href = null,
		customising = false,
		dragging = false,
		widthBadge = null,
		narrow = false,
		canMoveUp = false,
		canMoveDown = false,
		onremove,
		onmoveup,
		onmovedown,
		onpointerdown,
		onresizestart,
		controls,
		headControls,
		children
	}: {
		title: string;
		icon: IconName;
		/** The panel's identity colour, from the registry. */
		hue?: string;
		/** A count or a period, right of the title and half its weight. */
		sub?: string | null;
		/** The screen this panel is a summary of, if any. */
		href?: string | null;
		customising?: boolean;
		dragging?: boolean;
		widthBadge?: string | null;
		narrow?: boolean;
		canMoveUp?: boolean;
		canMoveDown?: boolean;
		onremove?: () => void;
		onmoveup?: () => void;
		onmovedown?: () => void;
		onpointerdown?: (event: PointerEvent) => void;
		onresizestart?: (event: PointerEvent) => void;
		/** A control on the head row, left of "Open →": the flow panel's period.
		 *  Drawn only when `headControls` names one, since a snippet reference is
		 *  truthy regardless of what it renders. */
		controls?: Snippet;
		headControls?: 'period';
		children: Snippet;
	} = $props();
</script>

<section class="panel" class:customising class:dragging class:narrow>
	<header>
		<span class="head">
			<IconTile {hue} {icon} size={26} />
			<span class="name">{title}</span>
			{#if sub}<span class="sub">{sub}</span>{/if}
		</span>
		{#if customising}
			<span class="controls">
				{#if widthBadge}<span class="mono badge">{widthBadge}</span>{/if}
				{#if narrow}
					<button
						type="button"
						onclick={onmoveup}
						disabled={!canMoveUp}
						aria-label="Move {title} up">↑</button
					>
					<button
						type="button"
						onclick={onmovedown}
						disabled={!canMoveDown}
						aria-label="Move {title} down">↓</button
					>
				{/if}
				<button type="button" class="remove" onclick={onremove} aria-label="Remove {title}"
					>✕</button
				>
			</span>
		{:else}
			{#if controls && headControls}
				<span class="head-controls">{@render controls()}</span>
			{/if}
		{/if}
		{#if !customising && href}
			<!-- Gives way to the customise controls: while arranging, the header belongs to moving/removing. -->
			<a class="open" {href} aria-label="Open {title}">Open →</a>
		{/if}
	</header>

	<!-- Inert while customising, else a drag starting on a row (e.g. Recent
	     activity) would open that link instead of moving the panel.
	     role="group" rather than a bare div, since a div with a pointer handler
	     is nothing to a screen reader. -->
	<div
		class="body"
		class:inert={customising}
		role="group"
		onpointerdown={customising && !narrow ? onpointerdown : undefined}
	>
		{@render children()}
	</div>

	{#if customising && !narrow}
		<button type="button" class="handle" aria-label="Resize {title}" onpointerdown={onresizestart}
		></button>
	{/if}
</section>

<style>
	.panel {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 18px 20px;
		/* The stored height is a floor: content may exceed it. */
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.panel.customising {
		border-color: var(--brand);
	}
	.panel.customising .body {
		cursor: grab;
	}
	.panel.dragging {
		border-color: var(--brand);
		z-index: 5;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		margin-bottom: var(--space-6);
		flex: none;
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
	}
	.name {
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub {
		font-size: var(--text-sm);
		color: var(--fg3);
		white-space: nowrap;
		flex: none;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex: none;
	}
	/* Quiet on purpose: it's on every panel. Hover is the whole affordance, so the global underline is off. */
	.head-controls {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		margin-left: auto;
		min-width: 0;
	}
	.open {
		flex: none;
		font-size: var(--text-sm);
		color: var(--fg3);
		white-space: nowrap;
	}
	.open:hover {
		color: var(--fg1);
		text-decoration: none;
	}
	.badge {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.controls button {
		background: var(--card2);
		border: 1px solid var(--bd);
		border-radius: var(--radius-sm);
		color: var(--fg2);
		font-size: var(--text-xs);
		line-height: 1;
		padding: 4px 7px;
		cursor: pointer;
	}
	.controls button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.controls button:hover:not(:disabled) {
		background: var(--card3);
	}
	.remove {
		color: var(--fg3);
	}
	/* Not a scroller: rows grow with content (`minmax(row, auto)`), so the page is the one thing that scrolls. */
	.body {
		flex: 1;
		min-height: 0;
		overflow: visible;
	}
	.body.inert > :global(*) {
		pointer-events: none;
	}
	.panel.narrow {
		height: auto;
	}
	.panel.narrow .body {
		overflow: visible;
	}
	.handle {
		position: absolute;
		right: 2px;
		bottom: 2px;
		width: 16px;
		height: 16px;
		padding: 0;
		border: none;
		background: transparent;
		cursor: nwse-resize;
	}
	.handle::after {
		content: '';
		position: absolute;
		right: 3px;
		bottom: 3px;
		width: 8px;
		height: 8px;
		border-right: 2px solid var(--bd2);
		border-bottom: 2px solid var(--bd2);
	}
</style>
