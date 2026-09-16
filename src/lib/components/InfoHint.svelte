<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import Icon from '$lib/components/Icon.svelte';
	import type { Snippet } from 'svelte';

	let {
		label,
		children
	}: {
		/** What the button announces, e.g. "How to connect iCloud". */
		label: string;
		children: Snippet;
	} = $props();

	let open = $state(false);
	let hovering = $state(false);
	let wrap = $state<HTMLElement | null>(null);
	/** Which side the bubble hangs from, decided by where the icon actually is. */
	let side = $state<'left' | 'right'>('left');

	// Measured rather than guessed: CSS alone can't know how much room is to
	// the right of the icon before the bubble opens.
	function chooseSide() {
		const box = wrap?.getBoundingClientRect();
		if (!box) return;
		const room = window.innerWidth - box.left;
		side = room < 360 ? 'right' : 'left';
	}

	// Shown on hover OR pinned open by click/keyboard — hover alone would miss
	// touch and keyboard users.
	const visible = $derived(open || hovering);
</script>

<span
	class="wrap"
	bind:this={wrap}
	onmouseenter={() => {
		chooseSide();
		hovering = true;
	}}
	onmouseleave={() => (hovering = false)}
	role="presentation"
>
	<button
		type="button"
		class="dot"
		aria-label={label}
		aria-expanded={open}
		onclick={() => {
			chooseSide();
			open = !open;
		}}
	>
		<Icon name="info" />
	</button>

	{#if visible}
		<span class="bubble" class:from-right={side === 'right'} role="note">
			{@render children()}
		</span>
	{/if}
</span>

<style>
	.wrap {
		position: relative;
		display: inline-flex;
		vertical-align: middle;
	}

	.dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		border: none;
		background: none;
		color: var(--fg3);
		cursor: pointer;
	}

	.dot:hover,
	.dot[aria-expanded='true'] {
		color: var(--blue);
	}

	.bubble {
		position: absolute;
		/* Below rather than above: a card at the top of the viewport would clip it. */
		top: 22px;
		left: -4px;
		z-index: 20;
		width: max-content;
		max-width: 340px;
		padding: var(--space-5) var(--space-6);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		/* --bg2, not --card: --card is a translucent tint in the dark theme and
		   would be nearly transparent on a floating surface. */
		background: var(--bg2);
		color: var(--fg1);
		font-size: var(--text-sm);
		line-height: 1.5;
		/* Heavier than a card's shadow, to read as detached from the page. */
		box-shadow: var(--shadow-float);
		text-align: left;
		white-space: normal;
	}

	/* Hangs from the icon's right edge instead, for an icon near the screen edge. */
	.bubble.from-right {
		left: auto;
		right: -4px;
	}

	@media (max-width: 40rem) {
		.bubble,
		.bubble.from-right {
			/* Spans the viewport instead of anchoring, since it would run off
			   either edge on a narrow screen. */
			position: fixed;
			left: 12px;
			right: 12px;
			width: auto;
			max-width: none;
		}
	}
</style>
