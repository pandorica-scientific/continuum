<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import type { Snippet } from 'svelte';

	let {
		title,
		emoji,
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
		children
	}: {
		title: string;
		emoji: string;
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
		children: Snippet;
	} = $props();
</script>

<section class="panel" class:customising class:dragging class:narrow>
	<header>
		<span class="eyebrow"><span aria-hidden="true">{emoji}</span>{title}</span>
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
		{/if}
	</header>

	<!--
		Panel content is inert while customising. Panels hold links and scrollable
		rows, so without this a drag that starts on a row inside Recent activity
		opens that transaction instead of moving the panel.

		role="group" rather than a bare div, because a div carrying a pointer
		handler is nothing at all to a screen reader. Moving a panel is a drag on
		the wide board; the header's arrows are the route in the narrow one.
	-->
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
		background: var(--card);
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		padding: 14px 16px;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.panel.customising {
		border-color: var(--bd2);
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
		margin-bottom: 10px;
		flex: none;
	}
	.eyebrow {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: var(--text-xs);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex: none;
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
	/* Fixed box: content taller than the panel scrolls inside it. */
	.body {
		flex: 1;
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
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
