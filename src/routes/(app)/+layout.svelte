<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import Sidebar from '$lib/components/Sidebar.svelte';
	import BottomBar from '$lib/components/BottomBar.svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import IconTile from '$lib/components/IconTile.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import InfoHint from '$lib/components/InfoHint.svelte';
	import FileViewer from '$lib/components/FileViewer.svelte';
	import type { ViewerSource } from '$lib/ui/file-viewer';
	import type { IconName } from '$lib/icons';
	import { overlayFocus } from '$lib/actions/overlay';
	import { filePreview } from '$lib/actions/file-preview';

	let { data, children } = $props();

	let drawerOpen = $state(false);

	// Every `/files/…` link in the app opens here instead of in a browser tab —
	// wired once, on the shell, rather than screen by screen. See
	// $lib/actions/file-preview for why it is delegated.
	let openFile = $state<{ source: ViewerSource; title: string } | null>(null);

	// Pinned and hovered are separate states, exactly as InfoHint keeps them.
	// One shared flag looks fine until a pointer arrives: hovering opens the
	// menu, and the click that follows then toggles it straight shut.
	// Dismissing is remembered against WHICH currencies were flagged, so hiding
	// today's warning does not hide a different one tomorrow — and it is kept in
	// localStorage, because a banner that comes back on every page load has not
	// really been dismissed.
	// Which currencies this warning is about, AND WHY — the two buckets are kept
	// apart in the key, not merged into one list. Flattened, a dismissal of the
	// harmless "converts at the oldest rate on record" warning for EUR produced
	// the key 'EUR', so when the refresh later failed and EUR moved to "no rate at
	// all" the key was still 'EUR', the banner never drew, and net worth counted
	// EUR holdings at face value with nothing on screen to say so — for a year,
	// which is how long the cookie lasts.
	const warningKey = $derived(
		[
			`none:${[...data.missingRates.none].sort().join(',')}`,
			`carried:${[...data.missingRates.carried].sort().join(',')}`
		].join('|')
	);
	const anyMissingRates = $derived(
		data.missingRates.none.length + data.missingRates.carried.length > 0
	);

	// Seeded from the SERVER, not from localStorage. localStorage is invisible
	// during rendering, so the banner drew, hydrated, and vanished — a flash on
	// every page load of a thing already dismissed. A cookie the server can read
	// means it is simply never rendered.
	let rateDismissed = $derived(data.rateWarningDismissed);
	const showRateWarning = $derived(anyMissingRates && rateDismissed !== warningKey);

	function dismissRateWarning() {
		rateDismissed = warningKey;
		// A year: the same currencies will still be approximate tomorrow, and being
		// asked again next week is the thing being dismissed.
		document.cookie = `continuum_rate_dismissed=${encodeURIComponent(warningKey)}; path=/; max-age=31536000; samesite=lax`;
	}

	let quickPinned = $state(false);
	let quickHovering = $state(false);
	const quickOpen = $derived(quickPinned || quickHovering);

	// What "add" can mean right now.
	//
	// Every entry is gated on its module, so the menu never offers a screen that
	// would 404. Importing is no longer restricted to Overview and Money: that
	// gating existed because a bare floating button on the Property screen was
	// just something in the way, and a named menu item is not.
	const quickAdds = $derived(
		[
			// The hue is the AREA's, so the tile beside "XTB statement" is the same
			// purple as the Assets row that leads to the same screen.
			data.modules.import
				? { href: '/import', label: 'Bank statements', icon: 'inbox' as IconName, hue: 'teal' }
				: null,
			data.modules.investments
				? { href: '/investments', label: 'XTB statement', icon: 'chart' as IconName, hue: 'purple' }
				: null,
			data.modules.calendar
				? {
						href: '/calendar',
						label: 'Calendar event',
						icon: 'calendar' as IconName,
						hue: 'indigo'
					}
				: null,
			data.modules.contacts
				? { href: '/contacts', label: 'Contact', icon: 'people' as IconName, hue: 'indigo' }
				: null,
			data.modules.documents
				? { href: '/documents?add=1', label: 'Document', icon: 'folders' as IconName, hue: 'fg3' }
				: null,
			// The two Money screens that are FILED rather than imported. Both open
			// their form on arrival, the way /documents?add=1 already does — a menu
			// item that lands you on a screen you then have to find a button on is
			// half a shortcut.
			data.modules.salary
				? { href: '/salary?add=1', label: 'Payslip', icon: 'wallet' as IconName, hue: 'teal' }
				: null,
			data.modules.tax
				? { href: '/tax?add=1', label: 'Tax statement', icon: 'receipt' as IconName, hue: 'teal' }
				: null
		].filter((item) => item !== null)
	);
</script>

<div class="shell" use:filePreview={{ open: (source, title) => (openFile = { source, title }) }}>
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
			signedIn={data.signedIn}
			netWorth={data.netWorth}
			netWorthDelta={data.netWorthDelta}
			netWorthDeltaPositive={data.netWorthDeltaPositive}
			baseCurrency={data.baseCurrency}
			importBadge={data.importBadge}
			version={data.version}
			runtime={data.runtime}
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
		<!-- The brand, on a phone only. The sidebar it normally lives in is a
		     drawer down here, so without this the app has no name on screen. -->
		<div class="phone-brand">
			<span class="phone-mark"><BrandMark size={18} /></span>
			<span class="phone-word">Continuum</span>
		</div>
		<!-- The open-instance banner used to live here, on every screen. It now
		     appears in Settings, where it can be acted on, and on the SIGN-IN page,
		     which is where somebody who did not expect an open instance actually
		     meets it — before they are inside.
		     The trade is deliberate and worth naming: somebody who did not turn it
		     on will not be reminded unless they visit Settings. Against that, a
		     warning on every screen forever is one nobody reads. -->
		{#if showRateWarning}
			<!-- The FACT stays on screen: a figure being approximate is exactly the
			     kind of thing that must not hide behind an icon. Only the reason
			     moves — and the two reasons want different advice, so they are told
			     apart rather than lumped under one line about the internet. -->
			<p class="rate-warning" role="status">
				<span>
					Approximate exchange rate for {[
						...data.missingRates.none,
						...data.missingRates.carried
					].join(', ')}.
				</span>
				<InfoHint label="Why this rate is approximate">
					{#if data.missingRates.none.length > 0}
						<strong class="warn">
							No rate at all is stored for {data.missingRates.none.join(', ')}, so those amounts are
							counted at face value.
						</strong>
						Check the internet connection — rates come from the Czech National Bank and refresh every
						six hours.
					{/if}
					{#if data.missingRates.carried.length > 0}
						{data.missingRates.carried.join(', ')} converts at the oldest rate on record, because the
						figures involved are dated before this instance's first stored fixing. That happens to any
						ledger holding history older than itself, and there is nothing to fix — the Czech National
						Bank publishes forward, so past days cannot gain a rate of their own.
					{/if}
				</InfoHint>
				<button
					type="button"
					class="rate-dismiss"
					aria-label="Dismiss"
					onclick={dismissRateWarning}
				>
					×
				</button>
			</p>
		{/if}
		{@render children()}
	</main>

	<BottomBar
		modules={data.modules}
		importBadge={data.importBadge}
		{drawerOpen}
		onopen={() => (drawerOpen = true)}
	/>

	<!-- Quick add: one target for the things done often, on every screen. It
	     replaced a header button that led to the same place, and the menu is what
	     lets it stay everywhere — a bare plus on the Retirement screen was
	     ambiguous, a named list is not. -->
	{#if quickAdds.length > 0}
		<!-- Opens on hover AND on click: there is no hover on a phone, and a
		     keyboard user never triggers one. -->
		<div
			class="quick-wrap"
			onmouseenter={() => (quickHovering = true)}
			onmouseleave={() => {
				quickHovering = false;
				quickPinned = false;
			}}
			role="presentation"
		>
			{#if quickOpen}
				<div class="quick-menu" role="menu">
					{#each quickAdds as item (item.href)}
						<a
							href={item.href}
							class="quick-item"
							role="menuitem"
							onclick={() => {
								quickPinned = false;
								quickHovering = false;
							}}
						>
							<IconTile hue={item.hue} icon={item.icon} size={28} />
							{item.label}
						</a>
					{/each}
				</div>
			{/if}
			<button
				type="button"
				class="quick-add"
				aria-label="Quick add"
				aria-expanded={quickOpen}
				onclick={() => (quickPinned = !quickPinned)}
			>
				<Icon name="plus" size={22} />
			</button>
		</div>
	{/if}

	{#if openFile}
		<FileViewer
			src={openFile.source.src}
			kind={openFile.source.kind}
			download={openFile.source.download}
			title={openFile.title}
			onclose={() => (openFile = null)}
		/>
	{/if}
</div>

<style>
	/* Three layouts, one markup. The columns are the only thing that changes:
	   a 264px sidebar on a monitor, a 76px rail on a tablet, and nothing at all
	   on a phone, where BottomBar takes over and `.side` becomes a drawer. */
	.shell {
		display: grid;
		grid-template-columns: 264px minmax(0, 1fr);
		min-height: 100vh;
		align-items: start;
	}

	/* Sticky rather than in the flow: the navigation used to scroll away with the
	   page, so on anything shorter than the content — a tablet above all — you had
	   to scroll back to the top to move between screens.
	   `align-items: start` on the grid is what lets this work: stretched to the
	   row's full height, a sticky element has nothing left to stick within. */
	.side {
		position: sticky;
		top: 0;
		/* dvh, not vh: a mobile browser's chrome hides and reappears, and vh is
		   measured against the largest viewport, so the sidebar would be taller
		   than the screen and its last item would sit below the fold.
		   The scrolling belongs to `aside` inside this, which is the element
		   carrying the background — two scroll containers here would fight. */
		height: 100dvh;
	}
	main {
		padding: 26px 32px 60px;
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		min-width: 0;
		/* The screen settling in. Keyed on nothing, so it runs once per mount —
		   a SvelteKit navigation remounts the page component, which is exactly
		   when this should play. Collapsed to 1ms by the reduced-motion block in
		   app.css along with everything else. */
		animation: v2-in var(--dur-slow) var(--ease);
	}

	.phone-brand {
		display: none;
		align-items: center;
		gap: var(--space-5);
	}
	.phone-mark {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--brand) var(--tile-alpha), transparent);
		color: var(--brand);
	}
	.phone-word {
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.015em;
	}

	.quick-wrap {
		position: fixed;
		right: 24px;
		bottom: 24px;
		z-index: 30;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-4);
	}

	.quick-menu {
		display: flex;
		flex-direction: column;
		/* Opaque: this floats over whatever is scrolling beneath it. */
		background: var(--bg2);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-card);
		padding: var(--space-3);
		box-shadow: var(--shadow-float);
		min-width: 210px;
	}

	.quick-item {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-lg);
		color: var(--fg1);
		font-size: var(--text-md);
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
		transition: background-color var(--dur) var(--ease);
	}

	.quick-item:hover {
		background: var(--surface-2);
		text-decoration: none;
	}

	/* The one control that is lit rather than drawn: it wears the hero's own
	   gradient and shadow, so the thing that adds to the ledger and the figure
	   the ledger adds up are visibly the same colour. */
	.quick-add {
		display: grid;
		place-items: center;
		border: none;
		cursor: pointer;
		width: 52px;
		height: 52px;
		border-radius: var(--radius-pill);
		background: var(--hero-bg);
		box-shadow: var(--shadow-hero);
		color: #fff;
		transition:
			transform var(--dur) var(--ease),
			filter var(--dur) var(--ease);
	}
	.quick-add:hover {
		text-decoration: none;
		filter: brightness(1.12);
	}
	/* The plus becomes the ✕ that closes it. One glyph, rotated, rather than a
	   second icon swapped in — the rotation says the two are the same control. */
	.quick-add[aria-expanded='true'] {
		transform: rotate(45deg);
	}

	/* Wash, tile and hue border rather than a grey card with a coloured edge.
	   The 3px left edge it replaces was the only one of its kind in the app. */
	.rate-warning {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		margin: 0;
		padding: var(--space-6) var(--space-7);
		border: 1px solid color-mix(in srgb, var(--orange) 35%, transparent);
		border-radius: var(--radius-card);
		background: var(--orange-wash);
		color: var(--fg2);
		font-size: var(--text-md);
		line-height: 1.5;
	}

	.rate-dismiss {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--fg3);
		font-size: var(--text-2xl);
		line-height: 1;
		padding: 0 4px;
		cursor: pointer;
	}

	.rate-dismiss:hover {
		color: var(--fg1);
	}

	.warn {
		display: block;
		color: var(--red);
		margin-bottom: 6px;
	}

	/* ── Rail: a tablet ──────────────────────────────────────────────────── */
	@media (max-width: 1179px) {
		.shell {
			grid-template-columns: 76px minmax(0, 1fr);
		}
		main {
			padding: 22px 22px 60px;
		}
	}

	/* ── Phone ───────────────────────────────────────────────────────────── */
	@media (max-width: 719px) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
		}
		main {
			/* The bottom bar owns the last 62px plus the safe area, and a card
			   ending underneath it reads as content that has been cut off. */
			padding: 16px 14px 90px;
		}
		.phone-brand {
			display: flex;
		}
		.side {
			position: fixed;
			inset: 0 auto 0 0;
			width: 264px;
			z-index: 30;
			transform: translateX(-100%);
			/* A transformed element is still tabbable and exposed to assistive
			 * technology. Visibility removes the closed mobile drawer from both;
			 * the desktop sidebar is outside this media rule and remains visible. */
			visibility: hidden;
			transition:
				transform var(--dur) var(--ease),
				visibility var(--dur) var(--ease);
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
		/* Clear of the bottom bar, which is 62px plus the safe area. */
		.quick-wrap {
			right: 18px;
			bottom: 86px;
		}
		.quick-add {
			width: 46px;
			height: 46px;
		}
	}
</style>
