<script lang="ts">
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
	onmouseenter={() => (hovering = true)}
	onmouseleave={() => (hovering = false)}
	role="presentation"
>
	<button
		type="button"
		class="dot"
		aria-label={label}
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<Icon name="info" />
	</button>

	{#if visible}
		<span class="bubble" role="note">
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
		/* Below and left-aligned: above would clip inside a card that starts at
		   the top of the viewport, and these hints are several lines long. */
		top: 22px;
		left: -4px;
		z-index: 20;
		width: max-content;
		max-width: 340px;
		padding: 10px 12px;
		border: 1px solid var(--bd2);
		border-radius: 8px;
		/* --bg2, not --card. In the dark theme --card is rgba(255,255,255,0.03) —
		   a 3% tint meant to sit ON the page background, not to be a surface of its
		   own. A floating bubble painted with it is effectively transparent and
		   whatever is behind shows straight through the text. --bg2 is opaque in
		   both themes, which is why Lightbox uses the same family. */
		background: var(--bg2);
		color: var(--fg1);
		font-size: 12px;
		line-height: 1.5;
		/* Heavier than a card's shadow: this floats above the page and needs to
		   read as detached rather than as part of what is under it. */
		box-shadow: 0 8px 28px rgb(0 0 0 / 0.45);
		text-align: left;
		white-space: normal;
	}

	@media (max-width: 40rem) {
		.bubble {
			/* On a narrow screen a 340px bubble anchored to an icon runs off the
			   edge, so it spans the card instead. */
			position: fixed;
			left: 12px;
			right: 12px;
			width: auto;
			max-width: none;
		}
	}
</style>
