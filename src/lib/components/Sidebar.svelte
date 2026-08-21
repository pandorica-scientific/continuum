<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import BrandMark from './BrandMark.svelte';
	import Icon from './Icon.svelte';
	import { areaForPath, visibleAreas, type ModuleToggles } from '$lib/modules/registry';
	import type { Theme } from '$lib/theme';

	interface Props {
		modules: ModuleToggles;
		householdLabel: string;
		netWorth: string | null;
		netWorthDelta: string | null;
		netWorthDeltaPositive: boolean;
		baseCurrency: string;
		importBadge: number;
		version: string;
		runtime: 'docker' | 'node';
		onNavigate?: () => void;
	}

	let {
		modules,
		householdLabel,
		netWorth,
		netWorthDelta,
		netWorthDeltaPositive,
		baseCurrency,
		importBadge,
		version,
		runtime,
		onNavigate
	}: Props = $props();

	const areas = $derived(visibleAreas(modules));
	// An area is active when the screen you are on belongs to it, not when its
	// own path matches — /loans lights up Assets.
	const activeArea = $derived(areaForPath(page.url.pathname)?.key);

	// Seeded from what the pre-paint script already applied, which came from the
	// cookie the server wrote from this person's stored theme.
	let theme: Theme = $state(
		browser && document.documentElement.dataset.ledgerTheme === 'light' ? 'light' : 'dark'
	);

	// Applied to the document first and persisted after, so the colours change on
	// the click rather than on the round trip. The server owns the record — it
	// stores the choice against the person and refreshes the cookie `app.html`
	// reads before paint — so a failed write costs this tab's choice and nothing
	// else: the next load paints what was last saved.
	function setTheme(next: Theme) {
		theme = next;
		if (next === 'light') {
			document.documentElement.setAttribute('data-ledger-theme', 'light');
		} else {
			document.documentElement.removeAttribute('data-ledger-theme');
		}
		// The browser paints its own regions — pull-to-refresh, the rubber band,
		// a tablet's status bar — from this and not from any stylesheet, so it has
		// to be moved by hand or those areas keep the old theme's colour.
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', next === 'light' ? '#f3f0e9' : '#0e1117');
		void fetch('/settings/theme', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ theme: next })
		});
	}

	// The Import badge counts transactions awaiting review. Import is a screen
	// inside Money now, so the count surfaces on the area that holds it.
	const badgeArea = $derived(
		areas.find((area) => area.screens.some((screen) => screen.path === '/import'))?.key
	);
</script>

<aside>
	<div class="brand">
		<BrandMark size={22} />
		<span class="wordmark">Continuum</span>
	</div>

	{#if netWorth !== null}
		<div class="networth">
			<span class="eyebrow" style="letter-spacing: 0.07em;">Net worth</span>
			<span class="mono amount">{netWorth}<span class="ccy">{baseCurrency}</span></span>
			{#if netWorthDelta}
				<span class="delta" style:color={netWorthDeltaPositive ? 'var(--green)' : 'var(--red)'}>
					{netWorthDelta} this month
				</span>
			{/if}
		</div>
	{/if}

	<nav>
		{#each areas as area (area.key)}
			<!-- An area opens on its first live screen, so a row never leads
			     somewhere a switched-off module has emptied. -->
			<a
				href={area.screens[0].path}
				class="nav-item"
				class:active={activeArea === area.key}
				aria-current={activeArea === area.key ? 'page' : undefined}
				onclick={onNavigate}
				style:--row-hue="var(--{area.hue})"
			>
				<span class="icon" style:color="var(--row-hue)"><Icon name={area.icon} /></span>
				<span class="label">{area.label}</span>
				{#if area.key === badgeArea && importBadge > 0}
					<span class="badge mono">{importBadge}</span>
				{/if}
			</a>
		{/each}
	</nav>

	<div class="foot">
		<div class="themes">
			<button type="button" class:active={theme === 'dark'} onclick={() => setTheme('dark')}
				>🌙 Dark</button
			>
			<button type="button" class:active={theme === 'light'} onclick={() => setTheme('light')}
				>☀️ Light</button
			>
		</div>
		<div class="person">
			<span class="avatar">{householdLabel.slice(0, 1).toUpperCase() || '·'}</span>
			<span class="name">{householdLabel}</span>
			<!-- /logout has existed since the first release with nothing linking to
			     it; without this there is no way to switch accounts or sign in with
			     a passkey once a session exists. -->
			<form method="POST" action="/logout">
				<button type="submit" class="sign-out">Sign out</button>
			</form>
		</div>
		<!-- What is running, and how. Deliberately the quietest thing on the panel:
		     it is read once when something is wrong, and ignored the rest of the
		     time. Settings → Self-hosting has the rest. -->
		<a class="install" href="/settings" onclick={onNavigate}>
			<span class="mono">v{version}</span>
			<span aria-hidden="true">·</span>
			<span>{runtime === 'docker' ? 'Docker' : 'Node'}</span>
		</a>
	</div>
</aside>

<style>
	aside {
		background: var(--side);
		border-right: 1px solid var(--bd);
		padding: 20px 14px 22px;
		display: flex;
		flex-direction: column;
		gap: 22px;
		/* Fills whatever the wrapper gives it, which is the full screen height in
		   both layouts — the sticky column on a wide screen and the fixed drawer on
		   a narrow one. It used to set its own `100vh` and stick on its own, which
		   made two nested scroll containers once the wrapper did the same, and the
		   inner one overflowed wherever `vh` and `dvh` disagree.
		   The background lives here, so this is the element that has to reach the
		   bottom of the screen — otherwise the page shows beneath the navigation. */
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 0 8px;
	}
	.wordmark {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.networth {
		padding: 10px 12px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		background: var(--card);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.amount {
		font-size: var(--text-2xl);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.ccy {
		font-size: var(--text-sm);
		color: var(--fg3);
		margin-left: 5px;
	}
	.delta {
		font-size: var(--text-xs);
	}
	/* One row per area, no group headings: the areas are the grouping now. */
	nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.nav-item {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-5);
		padding: 8px 10px;
		border-radius: var(--radius-md);
		color: var(--fg2);
		font-size: var(--text-md);
		font-weight: 400;
	}
	/* Tinted with the row's OWN colour rather than a neutral grey: the icon
	   already carries that colour, so a grey wash underneath reads as a different
	   element highlighting rather than this one. Mixed at low strength so the
	   label stays readable in both themes. */
	.nav-item:hover {
		background: color-mix(in srgb, var(--row-hue) 14%, transparent);
		text-decoration: none;
	}
	.nav-item.active {
		background: color-mix(in srgb, var(--row-hue) 22%, transparent);
		color: var(--fg1);
		font-weight: 500;
	}
	/* The identity colour lives on the icon, set inline from the area's hue.
	   Inactive rows hold it back so the lit row still stands out. */
	.icon {
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.75;
	}
	.nav-item:hover .icon,
	.nav-item.active .icon {
		opacity: 1;
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		font-size: var(--text-2xs);
		color: var(--fg-inverse);
		background: var(--yellow);
		border-radius: 20px;
		padding: 1px 6px;
	}
	.foot {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		border-top: 1px solid var(--bd);
		padding-top: 14px;
	}
	.install {
		display: flex;
		align-items: baseline;
		gap: 5px;
		font-size: var(--text-xs);
		/* The dimmest foreground the palette has: present when looked for, never
		   competing with a navigation row. */
		color: var(--fg3);
		text-decoration: none;
		letter-spacing: 0.01em;
	}

	.install:hover {
		color: var(--fg2);
		text-decoration: none;
	}

	.themes {
		display: flex;
		gap: var(--space-3);
	}
	.themes button {
		flex: 1 1 0;
		border: 1px solid var(--bd);
		background: transparent;
		color: var(--fg3);
		border-radius: var(--radius-md);
		padding: 7px 4px;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.themes button.active {
		border-color: var(--bd2);
		background: var(--card2);
		color: var(--fg1);
	}
	.person {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: 0 4px;
	}
	.sign-out {
		border: 0;
		background: transparent;
		color: var(--fg2);
		font-size: var(--text-xs);
		cursor: pointer;
		padding: 2px 0;
	}
	.sign-out:hover {
		color: var(--fg1);
	}
	.avatar {
		width: 24px;
		height: 24px;
		border-radius: 24px;
		background: var(--card3);
		display: grid;
		place-items: center;
		font-size: var(--text-xs);
		flex: 0 0 auto;
	}
	.name {
		font-size: var(--text-sm);
		color: var(--fg2);
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
