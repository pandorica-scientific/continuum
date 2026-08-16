<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import BrandMark from './BrandMark.svelte';
	import Icon from './Icon.svelte';
	import { areaForPath, visibleAreas, type ModuleToggles } from '$lib/modules/registry';

	interface Props {
		modules: ModuleToggles;
		householdLabel: string;
		netWorth: string | null;
		netWorthDelta: string | null;
		netWorthDeltaPositive: boolean;
		baseCurrency: string;
		importBadge: number;
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
		onNavigate
	}: Props = $props();

	const areas = $derived(visibleAreas(modules));
	// An area is active when the screen you are on belongs to it, not when its
	// own path matches — /loans lights up Assets.
	const activeArea = $derived(areaForPath(page.url.pathname)?.key);

	let theme: 'dark' | 'light' = $state(
		browser && document.documentElement.dataset.ledgerTheme === 'light' ? 'light' : 'dark'
	);

	function setTheme(next: 'dark' | 'light') {
		theme = next;
		if (next === 'light') {
			document.documentElement.setAttribute('data-ledger-theme', 'light');
		} else {
			document.documentElement.removeAttribute('data-ledger-theme');
		}
		localStorage.setItem('ledger-theme', next);
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
			>
				<span class="icon"><Icon name={area.icon} /></span>
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
		position: sticky;
		top: 0;
		height: 100vh;
		overflow-y: auto;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 0 8px;
	}
	.wordmark {
		font-size: 15.5px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.networth {
		padding: 10px 12px;
		border: 1px solid var(--bd);
		border-radius: 10px;
		background: var(--card);
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.amount {
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.ccy {
		font-size: 12px;
		color: var(--fg3);
		margin-left: 5px;
	}
	.delta {
		font-size: 11.5px;
	}
	/* One row per area, no group headings: the areas are the grouping now. */
	nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.nav-item {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 8px;
		color: var(--fg2);
		font-size: 13.5px;
		font-weight: 400;
	}
	.nav-item:hover {
		background: var(--card2);
		text-decoration: none;
	}
	.nav-item.active {
		background: var(--card3);
		color: var(--fg1);
		font-weight: 500;
	}
	.icon {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--fg3);
	}
	.nav-item.active .icon {
		color: var(--fg1);
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		font-size: 10.5px;
		color: var(--fg-inverse);
		background: var(--yellow);
		border-radius: 20px;
		padding: 1px 6px;
	}
	.foot {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
		border-top: 1px solid var(--bd);
		padding-top: 14px;
	}
	.themes {
		display: flex;
		gap: 6px;
	}
	.themes button {
		flex: 1 1 0;
		border: 1px solid var(--bd);
		background: transparent;
		color: var(--fg3);
		border-radius: 8px;
		padding: 7px 4px;
		font-size: 12px;
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
		gap: 8px;
		padding: 0 4px;
	}
	.sign-out {
		border: 0;
		background: transparent;
		color: var(--fg2);
		font-size: 11.5px;
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
		font-size: 11px;
		flex: 0 0 auto;
	}
	.name {
		font-size: 12.5px;
		color: var(--fg2);
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
