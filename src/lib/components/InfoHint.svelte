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

	// Measured rather than guessed. The icon sits at the right-hand end of an
	// eyebrow row, so a bubble anchored to its left edge runs off the screen —
	// which is exactly what it did. Nothing in CSS alone knows how much room is
	// to the right of an element, so this checks before it opens.
	function chooseSide() {
		const box = wrap?.getBoundingClientRect();
		if (!box) return;
		const room = window.innerWidth - box.left;
		side = room < 360 ? 'right' : 'left';
	}

	// Shown on hover OR when pinned open by a click or keyboard.
	//
	// Hover alone would be wrong: there is no hover on a phone, and a keyboard
	// user never triggers it. Making the icon a real button that toggles means
	// the same instructions are reachable by pointer, touch and keyboard, and
	// hover is just a shortcut on top.
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
		/* Below rather than above: a card at the top of the viewport would clip it,
		   and these hints run to several lines. */
		top: 22px;
		left: -4px;
		z-index: 20;
		width: max-content;
		max-width: 340px;
		padding: var(--space-5) var(--space-6);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		/* --bg2, not --card. In the dark theme --card is rgba(255,255,255,0.03) —
		   a 3% tint meant to sit ON the page background, not to be a surface of its
		   own. A floating bubble painted with it is effectively transparent and
		   whatever is behind shows straight through the text. --bg2 is opaque in
		   both themes, which is why Lightbox uses the same family. */
		background: var(--bg2);
		color: var(--fg1);
		font-size: var(--text-sm);
		line-height: 1.5;
		/* Heavier than a card's shadow: this floats above the page and needs to
		   read as detached rather than as part of what is under it. */
		box-shadow: var(--shadow-float);
		text-align: left;
		white-space: normal;
	}

	/* Hanging from the icon's right edge instead, for an icon near the screen
	   edge. */
	.bubble.from-right {
		left: auto;
		right: -4px;
	}

	@media (max-width: 40rem) {
		.bubble,
		.bubble.from-right {
			/* On a narrow screen a 340px bubble anchored to an icon runs off the
			   edge whichever way it hangs, so it spans the viewport instead. */
			position: fixed;
			left: 12px;
			right: 12px;
			width: auto;
			max-width: none;
		}
	}
</style>
