<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import IconTile from './IconTile.svelte';
	import { areaForPath, visibleAreas, type ModuleToggles } from '$lib/modules/registry';
	import type { IconName } from '$lib/icons';
	import type { Snippet } from 'svelte';

	let {
		title,
		caption,
		syncedAt,
		icon,
		emoji,
		actions
	}: {
		title: string;
		caption: string;
		syncedAt?: string;
		/**
		 * A household-editable mark, in place of the area's icon.
		 *
		 * Shelves, accounts and subjects each carry an emoji the household chose,
		 * and on a screen that IS one of them that emoji is the identity — drawing
		 * the area's icon beside it would be two marks for one thing.
		 */
		emoji?: string;
		/** Only for screens outside the navigation; every listed screen names its
		 *  own icon in the registry. */
		icon?: IconName;
		/** A screen's single primary action, beside the title rather than buried
		 *  in a toolbar below it. Optional: most screens have none. */
		actions?: Snippet;
	} = $props();

	// Taken from the page rather than passed in: every screen already renders
	// this header, and threading the module toggles through sixteen call sites
	// to draw one row of pills would be a poor trade.
	const modules = $derived(page.data.modules as ModuleToggles | undefined);
	const area = $derived(modules ? areaForPath(page.url.pathname) : undefined);
	const screens = $derived(
		area && modules
			? (visibleAreas(modules).find((candidate) => candidate.key === area.key)?.screens ?? [])
			: []
	);
	// An area holding one screen renders no row at all — a single pill would be
	// a label pretending to be a choice.
	const tabs = $derived(screens.length > 1 ? screens : []);
	const current = $derived(
		area?.screens.find(
			(screen) =>
				page.url.pathname === screen.path || page.url.pathname.startsWith(screen.path + '/')
		)
	);
	const titleIcon = $derived(icon ?? current?.icon);

	function isCurrent(path: string): boolean {
		return page.url.pathname === path || page.url.pathname.startsWith(path + '/');
	}
</script>

<!-- The tab's name, from the one component every screen renders: a title
     per page used to be nowhere, and a browser tab reading only the address is
     the first thing a screen reader announces. -->
<svelte:head>
	<title>{title} · Continuum</title>
</svelte:head>

<header>
	<div class="titles">
		<h1>
			<!-- The area's hue in a tile, in place of the bare glyph — and in place
			     of the emoji prefix the title used to carry, which put a picture
			     inside the sentence a screen reader reads as its heading. -->
			{#if emoji}
				<IconTile hue="--{area?.hue ?? 'brand'}" {emoji} size={46} />
			{:else if titleIcon}
				<IconTile hue="--{area?.hue ?? 'brand'}" icon={titleIcon} size={46} />
			{/if}
			<span class="text">{title}</span>
		</h1>
		<span class="caption">{caption}</span>
	</div>
	<div class="actions">
		{#if syncedAt}
			<span class="synced"><Icon name="clock" size={14} /> synced {syncedAt}</span>
		{/if}
		<!-- Importing lives on the floating quick-add button, which is on every
		     screen that offers it. A second link in the header was the same
		     destination twice. -->
		{@render actions?.()}
	</div>
</header>

{#if tabs.length}
	<nav class="subtabs" aria-label="{area?.label} screens">
		{#each tabs as screen (screen.path)}
			<a
				href={screen.path}
				class="tab"
				class:active={isCurrent(screen.path)}
				aria-current={isCurrent(screen.path) ? 'page' : undefined}
				style:--tab-hue="var(--{area?.hue ?? 'brand'})"
			>
				<Icon name={screen.icon} size={15} />
				{screen.label}
			</a>
		{/each}
	</nav>
{/if}

<style>
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		flex-wrap: wrap;
	}
	.titles {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-size: var(--text-5xl);
		font-family: var(--font-display);
		font-weight: 650;
		letter-spacing: -0.025em;
		line-height: 1.15;
		display: flex;
		align-items: center;
		gap: var(--space-7);
		min-width: 0;
	}
	.text {
		min-width: 0;
	}
	.caption {
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.synced {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg3);
		border: 1px solid var(--bd);
		border-radius: var(--radius-ctl);
		padding: 7px 11px;
		background: var(--card);
		white-space: nowrap;
	}
	/* Money carries seven pills, which will not fit a narrow viewport on one
	   line. They scroll sideways rather than wrapping into a second row that
	   would shift every screen's content down by a variable amount. */
	.subtabs {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		margin-top: -6px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.subtabs::-webkit-scrollbar {
		display: none;
	}
	/* The rule under the row is gone: with a filled pill marking the current
	   screen, the line was a second answer to a question already answered, and
	   it cut the header off from the band of figures below it. */
	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		height: 34px;
		font-size: var(--text-md);
		color: var(--fg2);
		padding: 0 var(--space-6);
		border-radius: var(--radius-pill);
		white-space: nowrap;
		flex: none;
		transition:
			background-color var(--dur) var(--ease),
			color var(--dur) var(--ease);
	}
	.tab:hover {
		background: var(--surface-2);
		text-decoration: none;
	}
	.tab.active {
		background: color-mix(in srgb, var(--tab-hue) 18%, transparent);
		color: var(--fg1);
		font-weight: 600;
	}
	/* The icon carries the hue on the lit pill; on the others it stays as quiet
	   as the label, or seven colours compete for the same row. */
	.tab.active :global(svg) {
		color: var(--tab-hue);
	}

	@media (max-width: 719px) {
		h1 {
			font-size: var(--text-4xl);
			gap: var(--space-5);
		}
	}
</style>
