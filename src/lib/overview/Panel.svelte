<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { IconName } from '$lib/icons';

	let {
		title,
		icon,
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
		children
	}: {
		title: string;
		icon: IconName;
		/** The screen this panel is a summary of, if it has one. */
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
		children: Snippet;
	} = $props();
</script>

<section class="panel" class:customising class:dragging class:narrow>
	<header>
		<span class="eyebrow"><Icon name={icon} size={14} />{title}</span>
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
		{:else if href}
			<!--
				The one way through to the screen behind a panel. Three panels used to
				put a link of their own at the foot of their body instead, which meant
				the same destination sat in a different place on every panel that had
				one, and nowhere at all on the ten that did not.

				It gives way to the customise controls rather than sitting beside them:
				while the board is being arranged the header belongs to moving and
				removing, and a link there is one more thing a stray tap can follow.
			-->
			<a class="open" {href} aria-label="Open {title}">Open →</a>
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
		padding: var(--space-7) var(--space-8);
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
	/* Quiet on purpose: it is on every panel, and ten links competing with the
	   figures they sit above would be the loudest thing on the board. The hover
	   is the whole affordance, so the global underline is taken off it. */
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
