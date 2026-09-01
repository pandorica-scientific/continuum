<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { tick, untrack } from 'svelte';

	// A category chooser that opens where there is room for it.
	//
	// This replaces a native <select>, which is not a decision taken lightly: a
	// native select is accessible for free, works on every device, and needs no
	// code. But its popup is positioned by the browser and cannot be steered, and
	// on the review queue — a long list of rows, each with a chooser — opening one
	// near the bottom of the page expanded downwards past the fold, so the options
	// were off-screen until you scrolled to find them.
	//
	// What is rebuilt here is therefore only what a select gave away: where the
	// list appears, and how tall it is. Everything else a select provides is kept
	// deliberately — a real form value, group headings, keyboard traversal,
	// typeahead, and the combobox roles a screen reader expects.

	interface Item {
		id: string;
		name: string;
	}
	interface Group {
		key: string;
		label: string;
		items: Item[];
	}

	let {
		name,
		groups,
		value = null,
		placeholder = 'Choose a category…',
		onpick
	}: {
		name: string;
		groups: Group[];
		value?: string | null;
		placeholder?: string;
		onpick?: (id: string) => void;
	} = $props();

	// The INITIAL value, read once. untrack rather than a bare read: this is
	// deliberately not reactive, because the prop carries what the categoriser
	// suggested and a later re-render must not overwrite what a person has since
	// chosen with the suggestion they were rejecting.
	let selected = $state(untrack(() => value));
	let open = $state(false);
	let trigger = $state<HTMLButtonElement | null>(null);
	let list = $state<HTMLUListElement | null>(null);
	/** Which option the keyboard is on. Not the same as the chosen one. */
	let active = $state(-1);
	/** Placement, decided from measurement each time it opens. */
	let placement = $state<{ above: boolean; maxHeight: number }>({ above: false, maxHeight: 320 });

	const flat = $derived(groups.flatMap((group) => group.items));
	const chosen = $derived(flat.find((item) => item.id === selected) ?? null);

	/** Room below the trigger, or above it if there is more there. */
	function place() {
		if (!trigger) return;
		const rect = trigger.getBoundingClientRect();
		const margin = 8;
		const below = window.innerHeight - rect.bottom - margin;
		const above = rect.top - margin;
		// Below unless above is genuinely roomier — a list that jumps sides for a
		// few pixels is worse than one that is a little short.
		const useAbove = below < 180 && above > below;
		placement = {
			above: useAbove,
			maxHeight: Math.max(120, Math.min(320, useAbove ? above : below))
		};
	}

	async function show() {
		place();
		open = true;
		active = flat.findIndex((item) => item.id === selected);
		await tick();
		list?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
	}

	function hide() {
		open = false;
		active = -1;
		trigger?.focus();
	}

	function choose(id: string) {
		selected = id;
		open = false;
		trigger?.focus();
		onpick?.(id);
	}

	function move(delta: number) {
		if (!flat.length) return;
		active = (active + delta + flat.length) % flat.length;
		tick().then(() =>
			list?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
		);
	}

	// Typeahead, as a select has: type "gro" and land on Groceries. Cleared after
	// a pause so the next word starts fresh.
	let typed = '';
	let typedAt = 0;
	function typeahead(key: string) {
		const now = Date.now();
		typed = now - typedAt > 800 ? key : typed + key;
		typedAt = now;
		const found = flat.findIndex((item) => item.name.toLowerCase().startsWith(typed));
		if (found >= 0) {
			active = found;
			tick().then(() =>
				list
					?.querySelector<HTMLElement>('[data-active="true"]')
					?.scrollIntoView({ block: 'nearest' })
			);
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (!open) {
			if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
				event.preventDefault();
				void show();
			}
			return;
		}
		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				hide();
				break;
			case 'ArrowDown':
				event.preventDefault();
				move(1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				move(-1);
				break;
			case 'Home':
				event.preventDefault();
				active = 0;
				break;
			case 'End':
				event.preventDefault();
				active = flat.length - 1;
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				if (active >= 0) choose(flat[active].id);
				break;
			case 'Tab':
				hide();
				break;
			default:
				if (event.key.length === 1) typeahead(event.key.toLowerCase());
		}
	}
</script>

<svelte:window
	onresize={() => open && place()}
	onscroll={() => open && place()}
	onkeydown={(e) => e.key === 'Escape' && open && hide()}
/>

<div class="picker" class:open>
	<!-- The form value. A hidden input rather than the button, so this posts
	     exactly as the select it replaces did and every existing action is
	     untouched. Inside the wrapper, so the component is one element in the DOM
	     and anything scoping to it finds the value too. -->
	<input type="hidden" {name} value={selected ?? ''} />

	<button
		bind:this={trigger}
		type="button"
		class="trigger"
		class:empty={!chosen}
		role="combobox"
		aria-expanded={open}
		aria-controls="{name}-listbox"
		aria-haspopup="listbox"
		{onkeydown}
		onclick={() => (open ? hide() : show())}
	>
		<span class="label">{chosen ? chosen.name : placeholder}</span>
		<span class="caret" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<!-- Dismissed by clicking away. A button rather than a div so it is a real
		     control, and aria-hidden because it is scenery, not a choice. -->
		<button type="button" class="scrim" aria-hidden="true" tabindex="-1" onclick={hide}></button>
		<ul
			bind:this={list}
			id="{name}-listbox"
			class="list"
			class:above={placement.above}
			style:max-height="{placement.maxHeight}px"
			role="listbox"
			aria-label="Categories"
			tabindex="-1"
		>
			{#each groups as group (group.key)}
				<li class="group" role="group" aria-label={group.label}>
					<span class="group-label">{group.label}</span>
					<ul class="group-items" role="none">
						{#each group.items as item (item.id)}
							{@const index = flat.findIndex((entry) => entry.id === item.id)}
							<!-- No keyboard handler here on purpose. In the listbox pattern the
							     options are not focusable: focus stays on the combobox and every
							     key is handled there, which is what lets Up/Down/typeahead work
							     without the browser losing track of what is being edited. The
							     rule cannot see that, so it is answered rather than obeyed. -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<li
								class="option"
								role="option"
								aria-selected={item.id === selected}
								data-active={index === active}
								data-value={item.id}
								onclick={() => choose(item.id)}
								onmouseenter={() => (active = index)}
							>
								{item.name}
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.picker {
		position: relative;
		min-width: 0;
	}
	.trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		width: 100%;
		height: var(--control-h);
		box-sizing: border-box;
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: var(--radius-md);
		padding: 0 11px;
		font: inherit;
		font-size: var(--text-md);
		cursor: pointer;
		text-align: left;
	}
	.trigger.empty .label {
		color: var(--fg3);
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.caret {
		color: var(--fg3);
		flex: 0 0 auto;
	}
	.trigger:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}
	/* Covers the page so a click anywhere closes the list, and sits under it. */
	.scrim {
		position: fixed;
		inset: 0;
		background: none;
		border: 0;
		cursor: default;
		z-index: 40;
	}
	.list {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 41;
		margin: var(--space-2) 0 0;
		padding: var(--space-2);
		list-style: none;
		overflow-y: auto;
		/* Scrolling stops at this panel's own end. Without it the wheel is handed
		   on to whatever scrolls behind, so reaching the bottom here quietly
		   starts scrolling the page — and scrolling back moves the wrong one
		   first. See docs/ui-guidelines.md. */
		overscroll-behavior: contain;
		/* --bg2, not --card. The card tokens are TINTS in the dark theme —
		   rgba(255,255,255,0.03) — which read as a raised panel in the document
		   flow and as a transparent smear when something floats over content.
		   floating-surfaces.test.ts enforces this; it caught the mistake here. */
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-float);
	}
	/* The whole point: when there is no room beneath, it opens upwards instead of
	   expanding past the bottom of the page. */
	.list.above {
		top: auto;
		bottom: 100%;
		margin: 0 0 var(--space-2);
	}
	.group-items {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.group-label {
		display: block;
		padding: var(--space-3) var(--space-4) var(--space-1);
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--fg3);
	}
	.option {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-sm);
		font-size: var(--text-md);
		cursor: pointer;
	}
	.option[data-active='true'] {
		/* Opaque for the same reason as the list behind it. */
		background: var(--bg);
	}
	.option[aria-selected='true'] {
		color: var(--blue);
		font-weight: 500;
	}
</style>
