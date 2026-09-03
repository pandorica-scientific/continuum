<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import { areaForPath, visibleAreas, type Area, type ModuleToggles } from '$lib/modules/registry';

	/**
	 * The phone's navigation, below 720px.
	 *
	 * It replaces a ☰ button in the bottom-right corner that opened a drawer:
	 * every screen change was two taps, and the first of them was on a control
	 * with no state — nothing about it said where you already were.
	 *
	 * Four areas and the drawer. The design asked for five areas and no drawer,
	 * which does not fit seven: two of them would have been unreachable on a
	 * phone. The fifth slot is the way to the other three, plus settings and the
	 * theme — all of which already live in the sidebar this opens.
	 */
	interface Props {
		modules: ModuleToggles;
		importBadge: number;
		drawerOpen: boolean;
		onopen: () => void;
	}

	let { modules, importBadge, drawerOpen, onopen }: Props = $props();

	// The four a phone reaches for, in the order the sidebar lists them. Named
	// rather than "the first four visible", because that order puts Retirement —
	// a screen somebody opens twice a year — in front of Documents.
	const PREFERRED = ['overview', 'money', 'assets', 'documents'];

	const areas = $derived(visibleAreas(modules));

	// Falls back through whatever else is visible, so switching Documents off
	// leaves four filled slots rather than a gap.
	const slots = $derived.by(() => {
		const byKey = new Map(areas.map((a) => [a.key, a]));
		const picked: Area[] = PREFERRED.map((key) => byKey.get(key)).filter((a) => a !== undefined);
		for (const area of areas) {
			if (picked.length >= 4) break;
			if (!picked.includes(area)) picked.push(area);
		}
		return picked.slice(0, 4);
	});

	const activeArea = $derived(areaForPath(page.url.pathname)?.key);
	// The drawer holds everything not in a slot, so its badge is the import
	// badge whenever Money did not make it onto the bar.
	const badgeInDrawer = $derived(
		importBadge > 0 && !slots.some((a) => a.screens.some((s) => s.path === '/import'))
	);
</script>

<nav class="bar" aria-label="Sections">
	{#each slots as area (area.key)}
		<a
			href={area.screens[0].path}
			class="item"
			class:active={activeArea === area.key}
			aria-current={activeArea === area.key ? 'page' : undefined}
			style:--row-hue="var(--{area.hue})"
		>
			<span class="pill"><Icon name={area.icon} size={19} /></span>
			<span class="name">{area.label}</span>
			{#if importBadge > 0 && area.screens.some((s) => s.path === '/import')}
				<span class="badge" aria-label="{importBadge} transactions waiting"></span>
			{/if}
		</a>
	{/each}
	<button
		type="button"
		class="item more"
		aria-expanded={drawerOpen}
		aria-label="More"
		onclick={onopen}
	>
		<span class="pill"><Icon name="bars" size={19} /></span>
		<span class="name">More</span>
		{#if badgeInDrawer}
			<span class="badge" aria-label="{importBadge} transactions waiting"></span>
		{/if}
	</button>
</nav>

<style>
	.bar {
		display: none;
		position: fixed;
		inset: auto 0 0 0;
		z-index: 25;
		/* Opaque: content scrolls under this. --card is a tint in the dark theme
		   and would let the page through, which is the same defect the old ☰
		   button had. */
		background: var(--bg2);
		border-top: 1px solid var(--bd);
		padding: var(--space-3) var(--space-2) calc(var(--space-3) + var(--safe-bottom));
	}
	.item {
		position: relative;
		flex: 1 1 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		border: 0;
		background: none;
		padding: 0;
		font-family: inherit;
		color: var(--fg3);
		text-decoration: none;
		cursor: pointer;
	}
	.pill {
		display: grid;
		place-items: center;
		width: 46px;
		height: 28px;
		border-radius: var(--radius-lg);
		transition: background-color var(--dur) var(--ease);
	}
	.item.active {
		color: var(--row-hue);
	}
	.item.active .pill {
		background: color-mix(in srgb, var(--row-hue) var(--tile-alpha), transparent);
	}
	.name {
		font-size: var(--text-2xs);
		font-weight: 500;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.item.active .name {
		font-weight: 600;
	}
	.badge {
		position: absolute;
		top: 2px;
		right: calc(50% - 16px);
		width: 7px;
		height: 7px;
		border-radius: var(--radius-pill);
		background: var(--yellow);
	}
	.item:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
		border-radius: var(--radius-md);
	}
	@media (max-width: 719px) {
		.bar {
			display: flex;
		}
	}
</style>
