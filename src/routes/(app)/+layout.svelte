<script lang="ts">
	import Sidebar from '$lib/components/Sidebar.svelte';

	let { data, children } = $props();

	let drawerOpen = $state(false);
</script>

<div class="shell">
	<div class="side" class:open={drawerOpen}>
		<Sidebar
			modules={data.modules}
			householdLabel={data.householdLabel}
			netWorth={data.netWorth}
			netWorthDelta={data.netWorthDelta}
			netWorthDeltaPositive={data.netWorthDeltaPositive}
			baseCurrency={data.baseCurrency}
			importBadge={data.importBadge}
			onNavigate={() => (drawerOpen = false)}
		/>
	</div>
	{#if drawerOpen}
		<button type="button" class="scrim" aria-label="Close menu" onclick={() => (drawerOpen = false)}
		></button>
	{/if}

	<main>
		{#if data.missingRates.length > 0}
			<p class="rate-warning" role="status">
				No exchange rate for {data.missingRates.join(', ')}. Amounts in
				{data.missingRates.length > 1 ? 'those currencies' : 'that currency'} are counted at face value,
				so every converted total on these screens is understated. Check the internet connection — rates
				come from the Czech National Bank and refresh every six hours.
			</p>
		{/if}
		{@render children()}
	</main>

	<button type="button" class="menu-btn" aria-label="Menu" onclick={() => (drawerOpen = true)}>
		☰
	</button>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 252px minmax(0, 1fr);
		min-height: 100vh;
		align-items: stretch;
	}
	main {
		padding: 26px 32px 60px;
		display: flex;
		flex-direction: column;
		gap: 26px;
		min-width: 0;
	}
	.menu-btn {
		display: none;
	}
	.rate-warning {
		margin: 0;
		padding: 12px 14px;
		border: 1px solid var(--bd2);
		border-left: 3px solid var(--orange);
		border-radius: 10px;
		background: var(--card3);
		color: var(--fg2);
		font-size: 13px;
		line-height: 1.5;
	}

	@media (max-width: 1023px) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
		}
		main {
			padding: 20px 16px 60px;
		}
		.side {
			position: fixed;
			inset: 0 auto 0 0;
			width: 252px;
			z-index: 30;
			transform: translateX(-100%);
		}
		.side.open {
			transform: none;
		}
		.scrim {
			position: fixed;
			inset: 0;
			z-index: 20;
			background: rgba(0, 0, 0, 0.45);
			border: 0;
			cursor: pointer;
		}
		.menu-btn {
			display: grid;
			place-items: center;
			position: fixed;
			right: 16px;
			bottom: 16px;
			z-index: 10;
			width: 44px;
			height: 44px;
			border-radius: 12px;
			border: 1px solid var(--bd2);
			background: var(--card3);
			color: var(--fg1);
			font-size: 18px;
			cursor: pointer;
		}
	}
</style>
