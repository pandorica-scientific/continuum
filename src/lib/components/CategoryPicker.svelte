<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { tick, untrack } from 'svelte';

	// Replaces a native <select> only to control where its list opens (a native
	// select's popup can run off-screen on long pages). Keeps everything else a
	// select gives for free: real form value, group headings, keyboard
	// traversal, typeahead, and combobox a11y roles.

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

	// Initial value only, read once — must not be reactive, or a later
	// re-render of the suggested value would clobber the user's own choice.
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
		// Opens below unless above is genuinely roomier.
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

	// Typeahead: type "gro" to land on Groceries. Cleared after a pause.
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
	<!-- Hidden input posts the value exactly as the replaced <select> did. -->
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
		<!-- Dismisses on click-away; a button so it's a real control, aria-hidden
		     because it's scenery, not a choice. -->
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
							<!-- Listbox pattern: options aren't focusable, focus stays on the
							     combobox and keys are handled there. -->
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
	/* Covers the page so a click anywhere closes the list. */
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
		/* Contains scroll to this panel instead of the page behind it. */
		overscroll-behavior: contain;
		/* --bg2, not --card: --card is a translucent tint in the dark theme and
		   reads as a transparent smear when floating over content. */
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-float);
	}
	/* Opens upwards when there's no room beneath. */
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
		background: var(--bg);
	}
	.option[aria-selected='true'] {
		color: var(--blue);
		font-weight: 500;
	}
</style>
