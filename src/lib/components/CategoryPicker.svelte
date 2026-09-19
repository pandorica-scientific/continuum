<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { tick, untrack } from 'svelte';

	// Replaces a native <select> only to control where its list opens (a native
	// select's popup can run off-screen on long pages). Keeps everything else a
	// select gives for free: real form value, group headings, keyboard
	// traversal, search-as-you-type, and combobox a11y roles.

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

	/**
	 * What this picker has been told, versus what a person told it.
	 *
	 * `value` is the categoriser's suggestion and it can arrive AFTER the row
	 * does: filing one row teaches a rule that then suggests a category for
	 * every similar row still in the queue. Read once at creation, those
	 * pickers went on saying "Choose a category…" while the rest of the card
	 * updated around them, and only a page reload made the suggestion appear.
	 *
	 * Reading it reactively instead would trample a choice somebody had already
	 * made, which is why it was pinned in the first place. So both: the
	 * suggestion is followed until a person picks, and from that moment their
	 * choice is the answer and no later suggestion displaces it.
	 *
	 * `undefined` means "nobody has picked" — distinct from `null`, which is a
	 * deliberate choice of nothing.
	 */
	let ownChoice = $state<string | null | undefined>(undefined);
	const selected = $derived(ownChoice !== undefined ? ownChoice : value);
	let open = $state(false);
	let trigger = $state<HTMLButtonElement | null>(null);
	let list = $state<HTMLUListElement | null>(null);
	/** Which option the keyboard is on. Not the same as the chosen one. */
	let active = $state(-1);
	/** Placement, decided from measurement each time it opens. */
	let placement = $state<{ above: boolean; maxHeight: number }>({ above: false, maxHeight: 320 });

	/** What has been typed into the popup's search box. */
	let query = $state('');
	let search = $state<HTMLInputElement | null>(null);

	/**
	 * Case and diacritics folded, so "kavarna" finds "Kavárna" and a Czech
	 * category is reachable from a keyboard that will not type ě.
	 */
	const fold = (text: string) =>
		text
			.toLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '');

	/**
	 * The groups as the popup shows them, narrowed by what has been typed.
	 *
	 * A group whose own label matches keeps all of its items: typing "income"
	 * is a reasonable way to ask for everything filed under Income, and the
	 * group headings are on screen inviting exactly that. A group with no
	 * matching item and a non-matching label is dropped entirely rather than
	 * left as an empty heading.
	 */
	const matching = $derived.by(() => {
		const needle = fold(query.trim());
		if (!needle) return groups;
		return groups
			.map((group) =>
				fold(group.label).includes(needle)
					? group
					: { ...group, items: group.items.filter((item) => fold(item.name).includes(needle)) }
			)
			.filter((group) => group.items.length > 0);
	});

	const flat = $derived(matching.flatMap((group) => group.items));
	/** Searched over everything, so a chosen item still resolves while filtering. */
	const everything = $derived(groups.flatMap((group) => group.items));
	const chosen = $derived(everything.find((item) => item.id === selected) ?? null);

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
		// A fresh search each time: reopening to change an answer should not
		// start behind whatever was typed the last time.
		query = '';
		active = flat.findIndex((item) => item.id === selected);
		await tick();
		search?.focus();
		list?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
	}

	function hide() {
		open = false;
		active = -1;
		query = '';
		trigger?.focus();
	}

	/**
	 * Keep the keyboard on a row that still exists.
	 *
	 * Typing narrows the list under the cursor, so the index it was on can end
	 * up past the end, or on a different category than the one highlighted a
	 * keystroke ago. Landing on the first match is both safe and what somebody
	 * typing expects: type three letters, press Enter, get the obvious one.
	 */
	let lastQuery = '';
	$effect(() => {
		const typedNow = query;
		if (!open) {
			lastQuery = '';
			return;
		}
		// Only when the search actually CHANGED. Opening the popup already
		// highlighted whatever is currently chosen, and that is the more useful
		// place to start from than the top of the list.
		if (typedNow === lastQuery) return;
		lastQuery = typedNow;
		untrack(() => {
			active = flat.length > 0 ? 0 : -1;
		});
	});

	function choose(id: string) {
		ownChoice = id;
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

	/** Opening keys, on the closed trigger. */
	function ontriggerkeydown(event: KeyboardEvent) {
		if (open) return;
		if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
			event.preventDefault();
			void show();
			return;
		}
		// A letter opens the popup AND starts the search with it, so typing
		// straight at a closed picker does the obvious thing instead of nothing.
		if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault();
			void show().then(() => (query = event.key));
		}
	}

	/**
	 * Keys while the popup is open. They arrive on the search box, not the
	 * trigger — Space has to reach the field as a space, so it is no longer a
	 * way to choose; Enter is.
	 */
	function onsearchkeydown(event: KeyboardEvent) {
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
				// Only when the caret is already at the start, or Home stops doing
				// what it does in every other text field.
				if (event.currentTarget instanceof HTMLInputElement && event.currentTarget.value) break;
				event.preventDefault();
				active = 0;
				break;
			case 'End':
				if (event.currentTarget instanceof HTMLInputElement && event.currentTarget.value) break;
				event.preventDefault();
				active = flat.length - 1;
				break;
			case 'Enter':
				event.preventDefault();
				if (active >= 0 && flat[active]) choose(flat[active].id);
				break;
			case 'Tab':
				hide();
				break;
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
		onkeydown={ontriggerkeydown}
		onclick={() => (open ? hide() : show())}
	>
		<span class="label">{chosen ? chosen.name : placeholder}</span>
		<span class="caret" aria-hidden="true">▾</span>
	</button>

	{#if open}
		<!-- Dismisses on click-away; a button so it's a real control, aria-hidden
		     because it's scenery, not a choice. -->
		<button type="button" class="scrim" aria-hidden="true" tabindex="-1" onclick={hide}></button>
		<div class="popup" class:above={placement.above} style:max-height="{placement.maxHeight}px">
			<!-- Typing beats scrolling once there are more than a screenful of
			     categories, and a household accumulates them. Focus lands here on
			     open, so the popup can simply be typed at. -->
			<input
				bind:this={search}
				bind:value={query}
				class="search"
				type="text"
				autocomplete="off"
				spellcheck="false"
				placeholder="Type to search…"
				aria-label="Search categories"
				aria-controls="{name}-listbox"
				onkeydown={onsearchkeydown}
			/>
			<ul
				bind:this={list}
				id="{name}-listbox"
				class="list"
				role="listbox"
				aria-label="Categories"
				tabindex="-1"
			>
				{#each matching as group (group.key)}
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
				{#if matching.length === 0}
					<!-- Named rather than an empty box, and it names the way out: a
				     category that does not exist yet is made with the button
				     beside this picker. -->
					<li class="empty-note" role="presentation">
						Nothing matches “{query.trim()}”
					</li>
				{/if}
			</ul>
		</div>
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
	/*
	 * The floating panel. It holds the search box and the list, and the list is
	 * what scrolls — the search box stays put, or typing would push itself out
	 * of view as the list grew back.
	 */
	.popup {
		position: absolute;
		left: 0;
		right: 0;
		z-index: 41;
		display: flex;
		flex-direction: column;
		min-height: 0;
		margin: var(--space-2) 0 0;
		/* --bg2, not --card: --card is a translucent tint in the dark theme and
		   reads as a transparent smear when floating over content. */
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-float);
	}
	/* Opens upwards when there's no room beneath. */
	.popup.above {
		top: auto;
		bottom: 100%;
		margin: 0 0 var(--space-2);
	}
	.search {
		flex: 0 0 auto;
		box-sizing: border-box;
		width: 100%;
		border: none;
		border-bottom: 1px solid var(--bd);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
		background: none;
		color: var(--fg1);
		font: inherit;
		font-size: var(--text-md);
		padding: var(--space-4) 11px;
	}
	.search:focus {
		outline: none;
		border-bottom-color: var(--blue);
	}
	.search::placeholder {
		color: var(--fg3);
	}
	.list {
		margin: 0;
		padding: var(--space-2);
		list-style: none;
		overflow-y: auto;
		min-height: 0;
		/* Contains scroll to this panel instead of the page behind it. */
		overscroll-behavior: contain;
	}
	.empty-note {
		padding: var(--space-4);
		color: var(--fg3);
		font-size: var(--text-sm);
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
