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
		/** Household-editable mark, in place of the area's icon, for a screen
		 *  that IS a shelf/account/subject the household named. */
		emoji?: string;
		/** Only for screens outside the navigation; every listed screen names its
		 *  own icon in the registry. */
		icon?: IconName;
		/** A screen's single primary action, beside the title rather than buried
		 *  in a toolbar below it. Optional: most screens have none. */
		actions?: Snippet;
	} = $props();

	// Taken from the page rather than passed in — every screen renders this
	// header, so threading toggles through every call site isn't worth it.
	const modules = $derived(page.data.modules as ModuleToggles | undefined);
	const importBadge = $derived((page.data.importBadge as number | undefined) ?? 0);
	const tabBadge = (path: string): string | null =>
		path === '/import' && importBadge > 0
			? `${importBadge} transaction${importBadge === 1 ? '' : 's'} waiting to be reviewed`
			: null;
	const area = $derived(modules ? areaForPath(page.url.pathname) : undefined);
	const screens = $derived(
		area && modules
			? (visibleAreas(modules).find((candidate) => candidate.key === area.key)?.screens ?? [])
			: []
	);
	// A single pill would be a label pretending to be a choice.
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

<svelte:head>
	<title>{title} · Continuum</title>
</svelte:head>

<!-- `steady` reserves the slots above the tab row on a phone, so it lands
     in the same place on every screen of an area; skipped on one-screen areas. -->
<header class:steady={tabs.length > 0}>
	<div class="titles">
		<h1>
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
				{#if tabBadge(screen.path)}
					<span
						class="tab-badge"
						role="status"
						aria-label={tabBadge(screen.path)}
						title={tabBadge(screen.path)}
					></span>
				{/if}
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
	/* Scroll sideways rather than wrap, so a narrow viewport doesn't shift
	   content down by a variable amount. */
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
	.tab-badge {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-pill);
		background: var(--yellow);
		flex: none;
	}
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
	/* The icon carries the hue only on the lit pill, or colours compete on the row. */
	.tab.active :global(svg) {
		color: var(--tab-hue);
	}

	@media (max-width: 719px) {
		h1 {
			font-size: var(--text-4xl);
			gap: var(--space-5);
		}
		/* Reserve space for the caption and actions so the sub-tab row lands at
		   the same height on every screen when the header stacks on a phone —
		   otherwise switching tabs moves the row out from under the tapping thumb. */
		.steady .caption {
			display: block;
			min-height: calc(2 * 1.55em);
		}
		/* Stacked, not wrapped: an empty actions slot under `flex-wrap` takes no
		   height, so the reserved height only works if it's always its own row. */
		.steady {
			flex-direction: column;
			gap: var(--space-5);
		}
		.steady .actions {
			width: 100%;
			min-height: var(--control-h);
		}
	}
</style>
