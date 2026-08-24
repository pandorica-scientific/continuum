<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import { areaForPath, visibleAreas, type ModuleToggles } from '$lib/modules/registry';
	import type { IconName } from '$lib/icons';
	import type { Snippet } from 'svelte';

	let {
		title,
		caption,
		syncedAt,
		icon,
		actions
	}: {
		title: string;
		caption: string;
		syncedAt?: string;
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

<header>
	<div class="titles">
		<h1>
			{#if titleIcon}<span class="mark" style:color="var(--{area?.hue ?? 'brand'})"
					><Icon name={titleIcon} size={26} /></span
				>{/if}
			<span>{title}</span>
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
			>
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
	}
	h1 {
		margin: 0;
		font-size: var(--text-4xl);
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.2;
		display: flex;
		align-items: center;
		gap: 11px;
	}
	/* The mark carries the area's identity colour — the one place a hue appears
	   in content that is not a traffic-light state. Falls back to the brand for
	   a screen outside the navigation. */
	.mark {
		display: flex;
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
		border-radius: var(--radius-md);
		padding: 7px 11px;
		background: var(--card);
		white-space: nowrap;
	}
	/* Money carries seven pills, which will not fit a narrow viewport on one
	   line. They scroll sideways rather than wrapping into a second row that
	   would shift every screen's content down by a variable amount. */
	.subtabs {
		display: flex;
		gap: var(--space-3);
		align-items: center;
		border-bottom: 1px solid var(--bd);
		padding-bottom: 10px;
		margin-top: -8px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.subtabs::-webkit-scrollbar {
		display: none;
	}
	.tab {
		font-size: var(--text-md);
		color: var(--fg2);
		padding: 5px 12px;
		border-radius: 20px;
		white-space: nowrap;
		flex: none;
	}
	.tab:hover {
		background: var(--card2);
		text-decoration: none;
	}
	.tab.active {
		background: var(--card3);
		color: var(--fg1);
		font-weight: 500;
	}
</style>
