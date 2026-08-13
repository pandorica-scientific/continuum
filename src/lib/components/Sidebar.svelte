<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import BrandMark from './BrandMark.svelte';
	import { visibleNavGroups, type ModuleToggles } from '$lib/modules/registry';

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

	const groups = $derived(visibleNavGroups(modules));

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

	function isActive(path: string): boolean {
		return page.url.pathname === path || page.url.pathname.startsWith(path + '/');
	}
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
		{#each groups as group (group.label)}
			<div class="group">
				<span class="group-label">{group.label}</span>
				{#each group.items as item (item.path)}
					<a
						href={item.path}
						class="nav-item"
						class:active={isActive(item.path)}
						onclick={onNavigate}
					>
						<span class="icon">{item.emoji}</span>
						<span class="label">{item.label}</span>
						{#if item.path === '/import' && importBadge > 0}
							<span class="badge mono">{importBadge}</span>
						{/if}
					</a>
				{/each}
			</div>
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
	nav {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.group-label {
		font-size: 10.5px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--fg3);
		padding: 0 10px 5px;
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
		font-size: 14.5px;
		line-height: 1;
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
