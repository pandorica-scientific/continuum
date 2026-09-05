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
		children
	}: {
		title: string;
		icon: IconName;
		/** The panel's identity colour, from the registry. */
		hue?: string;
		/** A count or a period, right of the title and half its weight. */
		sub?: string | null;
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
		/** A control on the head row, left of "Open →": the flow panel's period. */
		controls?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="panel" class:customising class:dragging class:narrow>
	<header>
		<!-- A tile and a sentence-case name, not an uppercase eyebrow. Eighteen
		     tracked-out capitals were the loudest thing on a board whose whole
		     job is to let figures be read. -->
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
			{#if controls}
				<span class="head-controls">{@render controls()}</span>
			{/if}
		{/if}
		{#if !customising && href}
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
		background: var(--surface);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 18px 20px;
		/* Fills its rows and may exceed them: the stored height is a floor. */
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	/* The board being arranged is a mode, and the brand edge is what says so
	   on every panel at once. It used to be --bd2, a shade off the resting
	   border that nobody could see. */
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
	/* Quiet on purpose: it is on every panel, and ten links competing with the
	   figures they sit above would be the loudest thing on the board. The hover
	   is the whole affordance, so the global underline is taken off it. */
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
	/* Fixed box: content taller than the panel scrolls inside it. */
	/* The body is not a scroller. It was one, with `overscroll-behavior:
	   contain` so the wheel stopped at the panel's end — and a panel whose
	   content FITS is still a scroll container, so the wheel over any panel
	   went nowhere and the page could not be scrolled from most of the board.
	   The board's rows grow with their content instead (`minmax(row, auto)`),
	   so a tall panel makes a tall row and the page is the one thing that
	   scrolls. */
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
	/* A panel whose content carries `data-grow` is sized by that content and
	   never scrolls inside itself: the briefing, whose cards must all be on
	   screen when the strip is opened. `:has()` rather than a prop, because
	   the content is three components down from the header that would need
	   to be told. */
	.panel:has(:global([data-grow])) {
		height: auto;
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
