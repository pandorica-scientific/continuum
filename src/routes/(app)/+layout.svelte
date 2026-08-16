<script lang="ts">
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { page } from '$app/state';
	import { importOfferedAt } from '$lib/modules/registry';
	import { overlayFocus } from '$lib/actions/overlay';

	let { data, children } = $props();

	let drawerOpen = $state(false);
</script>

<div class="shell">
	<div
		class="side"
		class:open={drawerOpen}
		role={drawerOpen ? 'dialog' : undefined}
		aria-modal={drawerOpen ? 'true' : undefined}
		aria-label={drawerOpen ? 'Navigation menu' : undefined}
		use:overlayFocus={{ onclose: () => (drawerOpen = false), active: drawerOpen }}
	>
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
		<button
			type="button"
			class="scrim"
			data-overlay-keep
			aria-label="Close menu"
			onclick={() => (drawerOpen = false)}
		></button>
	{/if}

	<main>
		{#if data.missingRates.length > 0}
			<p class="rate-warning" role="status">
				Approximate exchange rate for {data.missingRates.join(', ')}. Amounts in
				{data.missingRates.length > 1 ? 'those currencies' : 'that currency'} dated before the first stored
				fixing use the oldest rate on record, and a currency with no fixing at all is counted at face
				value. Check the internet connection — rates come from the Czech National Bank and refresh every
				six hours.
			</p>
		{/if}
		{@render children()}
	</main>

	<button
		type="button"
		class="menu-btn"
		aria-label="Menu"
		aria-expanded={drawerOpen}
		onclick={() => (drawerOpen = true)}
	>
		☰
	</button>

	<!-- Quick add: a permanent target for the one thing done often, instead of a
	     trip through the header. Scoped to the areas where importing belongs —
	     Overview and Money — because a floating button over the Property or
	     Retirement screen is just something in the way. Hidden with its module
	     too, or it would lead to a 404. Named apart from the header button so
	     the two links are distinguishable by name. -->
	{#if importOfferedAt(page.url.pathname, data.modules)}
		<a href="/import" class="quick-add" aria-label="Quick add">
			<Icon name="plus" size={24} />
		</a>
	{/if}
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
	.quick-add {
		display: grid;
		place-items: center;
		position: fixed;
		right: 24px;
		bottom: 24px;
		z-index: 30;
		width: 52px;
		height: 52px;
		border-radius: 999px;
		background: var(--brand);
		color: var(--fg-inverse);
	}
	.quick-add:hover {
		text-decoration: none;
		filter: brightness(1.08);
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
			/* A transformed element is still tabbable and exposed to assistive
			 * technology. Visibility removes the closed mobile drawer from both;
			 * the desktop sidebar is outside this media rule and remains visible. */
			visibility: hidden;
		}
		.side.open {
			transform: none;
			visibility: visible;
		}
		.scrim {
			position: fixed;
			inset: 0;
			z-index: 20;
			background: rgba(0, 0, 0, 0.45);
			border: 0;
			cursor: pointer;
		}
		/* The menu button owns the bottom-right corner on a narrow screen, so
		   quick add stacks above it rather than on top of it. */
		.quick-add {
			right: 18px;
			bottom: 72px;
			width: 46px;
			height: 46px;
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
			/* Opaque, because this floats over content that scrolls under it.
			   --card3 is rgba(255,255,255,0.09) in the dark theme — a tint meant to
			   sit on the page background — so the page showed through the button and
			   the icon lost its contrast against whatever passed beneath. */
			background: var(--bg2);
			color: var(--fg1);
			font-size: 18px;
			cursor: pointer;
		}
	}
</style>
