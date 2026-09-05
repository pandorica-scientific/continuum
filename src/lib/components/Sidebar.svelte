<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import BrandMark from './BrandMark.svelte';
	import Icon from './Icon.svelte';
	import {
		areaForPath,
		SETTINGS_PATH,
		visibleAreas,
		type ModuleToggles
	} from '$lib/modules/registry';
	import type { Theme } from '$lib/theme';

	interface Props {
		modules: ModuleToggles;
		householdLabel: string;
		signedIn: { name: string; initials: string; hue: string } | null;
		netWorth: string | null;
		netWorthDelta: string | null;
		netWorthDeltaPositive: boolean;
		/** How big this month's change is against the biggest on record, 0–1. */
		netWorthDeltaShare: number | null;
		baseCurrency: string;
		importBadge: number;
		/** A currency converts at an approximate rate; the note is in Settings › Money. */
		approximateRates?: boolean;
		version: string;
		runtime: 'docker' | 'node';
		onNavigate?: () => void;
	}

	let {
		modules,
		householdLabel,
		signedIn,
		netWorth,
		netWorthDelta,
		netWorthDeltaPositive,
		netWorthDeltaShare,
		baseCurrency,
		importBadge,
		approximateRates = false,
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
			?.setAttribute('content', next === 'light' ? '#eeeae2' : '#0e1117');
		void fetch('/settings/theme', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ theme: next })
		});
	}

	// The Import badge counts transactions awaiting review. Import is a screen
	// inside Money now, so the count surfaces on the area that holds it.
	// /settings belongs to no area now, so nothing in the nav lights up for it —
	// the gear does instead.
	const onSettings = $derived(
		page.url.pathname === SETTINGS_PATH || page.url.pathname.startsWith(SETTINGS_PATH + '/')
	);

	// The Money area, or wherever Import lives if the registry moves it. Not
	// undefined when Import is switched off: the same dot says a rate is
	// approximate, and that is true of the totals whether or not anything is
	// being imported.
	const badgeArea = $derived(
		areas.find((area) => area.screens.some((screen) => screen.path === '/import'))?.key ??
			areas.find((area) => area.key === 'money')?.key
	);

	const initials = $derived(signedIn?.initials || signedIn?.name.slice(0, 1).toUpperCase() || '·');
</script>

<aside>
	<div class="brand">
		<span class="brand-tile"><BrandMark size={18} /></span>
		<span class="wordmark">Continuum</span>
		<!-- Settings lives here rather than in the navigation. It used to share an
		     "Admin" row with Documents, which put configuration somebody opens
		     rarely behind the same click as paperwork somebody opens often. A gear
		     beside the wordmark is where chrome belongs. -->
		<a
			class="settings"
			href={SETTINGS_PATH}
			aria-label="Settings"
			aria-current={onSettings ? 'page' : undefined}
			class:active={onSettings}
			onclick={onNavigate}
		>
			<Icon name="gear" size={16} />
		</a>
	</div>

	{#if netWorth !== null}
		<!-- The one lit surface in the product. It was a card among cards, which
		     made the figure the whole app exists to move look like a statistic;
		     v0.8.1 gives it the gradient and the only warm shadow, and puts white
		     type on it in BOTH themes so the number reads the same either way. -->
		<div class="hero" class:down={!netWorthDeltaPositive}>
			{#if netWorthDeltaShare !== null}
				<!-- The month, as a tide along the foot of the panel. Green when it
				     added and red when it took away, and it rises and darkens with the
				     size of the month measured against the biggest on record — a share
				     of net worth would say nothing, because a good month moves a
				     fraction of a per cent of a six-figure total.

				     Two near-circles far wider than the panel, turning slowly in
				     opposite directions: what crosses the top of the band is a long,
				     lazy arc that never repeats the same way twice. The reduced-motion
				     block in app.css stops them after one frame, which leaves a still
				     swell rather than a strobe. -->
				<span class="tide" style:--share={netWorthDeltaShare} aria-hidden="true">
					<span class="swell"></span>
					<span class="swell alt"></span>
				</span>
			{/if}
			<span class="hero-label">Net worth</span>
			<span class="hero-figure display">{netWorth}<span class="hero-ccy">{baseCurrency}</span></span
			>
			{#if netWorthDelta}
				<span
					class="hero-delta mono"
					title={netWorthDeltaShare === null
						? undefined
						: `${Math.round(netWorthDeltaShare * 100)}% of the biggest month on record`}
				>
					{netWorthDelta}
				</span>
				<span class="hero-note">this month</span>
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
				title={area.label}
				style:--row-hue="var(--{area.hue})"
			>
				<!-- Not IconTile: an idle nav tile's ground is a SURFACE, not a mix of
				     the row's hue, so the two states differ in kind rather than in
				     strength and the shared primitive has nothing to share. -->
				<span class="nav-tile"><Icon name={area.icon} size={17} /></span>
				<span class="label">{area.label}</span>
				{#if area.key === badgeArea && (importBadge > 0 || approximateRates)}
					<!-- A dot, not a count. The number was never acted on — it said
					     "something is waiting", which is what a dot says in a tenth of
					     the space, and the rail has no room for the digits at all.
					     The count survives for anyone not looking at the screen.
					     The same dot says an exchange rate is approximate: the banner
					     that used to say so sat above every screen's title and was
					     dismissed without being read; the note is in Settings › Money. -->
					<span
						class="badge"
						role="status"
						aria-label={[
							importBadge > 0 ? `${importBadge} transactions waiting to be reviewed` : null,
							approximateRates ? 'an exchange rate is approximate — see Settings' : null
						]
							.filter(Boolean)
							.join('; ')}
					></span>
				{/if}
			</a>
		{/each}
	</nav>

	<div class="foot">
		<div class="themes" role="group" aria-label="Theme">
			<button
				type="button"
				class:active={theme === 'dark'}
				aria-pressed={theme === 'dark'}
				title="Dark"
				onclick={() => setTheme('dark')}
			>
				<span aria-hidden="true">🌙</span><span class="theme-label">Dark</span>
			</button>
			<button
				type="button"
				class:active={theme === 'light'}
				aria-pressed={theme === 'light'}
				title="Light"
				onclick={() => setTheme('light')}
			>
				<span aria-hidden="true">☀️</span><span class="theme-label">Light</span>
			</button>
		</div>
		<div class="person">
			<span
				class="avatar"
				style:--person-hue="var({signedIn?.hue ?? '--fg3'})"
				title={signedIn?.name ?? householdLabel}>{initials}</span
			>
			<span class="who">
				<span class="name">{signedIn?.name ?? householdLabel}</span>
				<span class="household">{householdLabel}</span>
			</span>
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
		padding: 18px 14px 20px;
		display: flex;
		flex-direction: column;
		gap: 18px;
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
		gap: var(--space-5);
		padding: 0 var(--space-1);
	}
	.brand-tile {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--brand) var(--tile-alpha), transparent);
		color: var(--brand);
		flex: none;
	}
	.wordmark {
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.015em;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	.settings {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 9px;
		color: var(--fg3);
		flex: none;
		transition: background-color var(--dur) var(--ease);
	}
	.settings:hover,
	.settings.active {
		color: var(--fg1);
		background: var(--surface-2);
	}

	.hero {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 0 var(--space-3);
		padding: var(--space-6) var(--space-7) var(--space-7);
		border-radius: var(--radius-card);
		background: var(--hero-bg);
		box-shadow: var(--shadow-hero);
		/* The tide is drawn to the panel's own edges and clipped by them. */
		overflow: hidden;
		/* Fixed white rather than --fg1: the gradient is dark in both themes, so
		   a theme-following foreground would put near-black on navy in light. */
		color: #fff;
	}
	.hero-label {
		position: relative;
		z-index: 1;
		grid-column: 1 / -1;
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.75;
	}
	.hero-figure {
		position: relative;
		z-index: 1;
		grid-column: 1 / -1;
		font-size: var(--display-hero);
		margin: 3px 0 var(--space-3);
	}
	.hero-ccy {
		font-size: var(--text-sm);
		font-weight: 400;
		letter-spacing: 0;
		opacity: 0.7;
		margin-left: 5px;
	}
	/* Translucent white, not green or red: on this gradient a green pill is
	   unreadable, and the sign is already in the number — and the colour of the
	   month is the tide below it. */
	.hero-delta {
		position: relative;
		z-index: 1;
		justify-self: start;
		font-size: var(--text-xs);
		padding: 2px var(--space-4);
		border-radius: var(--radius-pill);
		background: rgba(255, 255, 255, 0.16);
	}
	.hero-note {
		position: relative;
		z-index: 1;
		font-size: var(--text-xs);
		opacity: 0.7;
		margin-left: var(--space-2);
	}

	/* The band the swells turn inside. Fixed height, so a quiet month is a low
	   wave in the same strip rather than a differently shaped panel. */
	.tide {
		position: absolute;
		inset: auto 0 0;
		height: 46px;
		overflow: hidden;
		pointer-events: none;
		/* From the two tide tokens, which app.css fixes in both themes for the
		   reason the type above is fixed white: this panel is dark in both. */
		--tide-ink: var(--tide-up);
		/* Faint for a month that barely moved, strong for a record one — but
		   never so faint it reads as a rendering fault; the floor is where a
		   quiet month is still visibly a tide. */
		opacity: calc(0.6 + 0.4 * var(--share));
	}
	.hero.down .tide {
		--tide-ink: var(--tide-down);
	}
	/* Far wider than the panel on purpose: only the top of a very large circle
	   crosses the band, so the edge reads as a swell and not as a bubble. */
	.swell {
		position: absolute;
		left: 50%;
		width: 520px;
		height: 520px;
		margin-left: -260px;
		/* Not 50%: a true circle turns without changing shape, and the wave is
		   the difference between the radii. */
		border-radius: 44%;
		/* Radial and centred, so the fade follows the wave's own curve rather
		   than a flat line across the band — and because a gradient concentric
		   with the circle it fills is the one kind that does not turn with it.
		   `closest-side` puts 100% on the rim; without it the stops are measured
		   to the corner and the edge never reaches transparent. */
		background: radial-gradient(
			circle closest-side,
			color-mix(in srgb, var(--tide-ink) 92%, transparent) 0 94%,
			color-mix(in srgb, var(--tide-ink) 55%, transparent) 97.5%,
			transparent 100%
		);
		/* Sunk so that between 10px and 40px of it shows, by the size of the
		   month. */
		bottom: calc(-520px + 10px + 30px * var(--share));
		/* Two motions on one element: the turn that makes the crest, and a slow
		   drift across the band so the crest visibly travels rather than only
		   changing shape in place — the difference between a tide and a stain. */
		animation:
			tide-roll 9s linear infinite,
			tide-drift 6.5s ease-in-out infinite alternate;
	}
	.swell.alt {
		width: 480px;
		height: 480px;
		margin-left: -240px;
		border-radius: 47%;
		background: radial-gradient(
			circle closest-side,
			color-mix(in srgb, var(--tide-ink) 62%, transparent) 0 94%,
			color-mix(in srgb, var(--tide-ink) 34%, transparent) 97.5%,
			transparent 100%
		);
		bottom: calc(-480px + 6px + 26px * var(--share));
		animation:
			tide-roll 7s linear infinite reverse,
			tide-drift 5s ease-in-out infinite alternate-reverse;
	}
	/* The drift moves the wrapper the swell turns inside, so the two
	   transforms do not fight over one property: the swell rotates, its
	   position slides. */
	.swell {
		animation-composition: add;
	}
	@keyframes tide-roll {
		from {
			transform: rotate(0turn);
		}
		to {
			transform: rotate(1turn);
		}
	}
	@keyframes tide-drift {
		from {
			transform: translateX(-22px);
		}
		to {
			transform: translateX(22px);
		}
	}

	/* One row per area, no group headings: the areas are the grouping now. */
	nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.nav-item {
		position: relative;
		display: grid;
		grid-template-columns: 32px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-6);
		height: 42px;
		padding: 0 var(--space-5) 0 5px;
		border-radius: var(--radius-xl);
		color: var(--fg2);
		font-size: 13.5px;
		font-weight: 500;
		transition:
			background-color var(--dur) var(--ease),
			color var(--dur) var(--ease);
	}
	.nav-tile {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 9px;
		background: var(--surface-2);
		color: var(--row-hue);
		flex: none;
		transition: background-color var(--dur) var(--ease);
	}
	/* Tinted with the row's OWN colour rather than a neutral grey: the icon
	   already carries that colour, so a grey wash underneath reads as a different
	   element highlighting rather than this one. */
	.nav-item:hover {
		background: color-mix(in srgb, var(--row-hue) 9%, transparent);
		text-decoration: none;
	}
	.nav-item.active {
		background: color-mix(in srgb, var(--row-hue) 14%, transparent);
		color: var(--fg1);
		font-weight: 600;
	}
	.nav-item.active .nav-tile {
		background: color-mix(in srgb, var(--row-hue) var(--tile-alpha-active), transparent);
	}
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-pill);
		background: var(--yellow);
		flex: none;
	}

	.foot {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		border-top: 1px solid var(--bd);
		padding-top: var(--space-7);
	}

	.themes {
		display: flex;
		gap: var(--space-1);
		padding: 3px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-ctl);
		background: var(--card);
	}
	.themes button {
		flex: 1 1 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		min-width: 0;
		border: 0;
		background: transparent;
		color: var(--fg3);
		border-radius: var(--radius-md);
		padding: 5px var(--space-3);
		font-size: var(--text-sm);
		font-family: inherit;
		cursor: pointer;
		transition: background-color var(--dur) var(--ease);
	}
	.themes button.active {
		background: var(--surface-3);
		color: var(--fg1);
		font-weight: 600;
	}
	.themes button:focus-visible {
		outline: 2px solid var(--blue);
		outline-offset: 2px;
	}

	.person {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding: 0 var(--space-2);
	}
	.avatar {
		width: 28px;
		height: 28px;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--person-hue) 26%, transparent);
		color: var(--fg1);
		display: grid;
		place-items: center;
		font-size: var(--text-xs);
		font-weight: 600;
		flex: 0 0 auto;
	}
	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		line-height: 1.25;
	}
	.name {
		font-size: var(--text-md);
		font-weight: 500;
		color: var(--fg1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.household {
		font-size: var(--text-xs);
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sign-out {
		border: 0;
		background: transparent;
		color: var(--fg2);
		font-size: var(--text-xs);
		cursor: pointer;
		padding: 2px 0;
		white-space: nowrap;
	}
	.sign-out:hover {
		color: var(--fg1);
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

	/* ── Rail ───────────────────────────────────────────────────────────────
	 * 720–1179px: a tablet, where 264px of navigation is a quarter of the
	 * screen. The same markup with the words taken away — every row keeps its
	 * `title`, so the label is a hover away and is still read aloud.
	 *
	 * A media query rather than a `variant` prop, deliberately: the layout is a
	 * function of the viewport and nothing else, and a prop would mean the
	 * server guessing a width it cannot know and hydrating into a correction.
	 */
	@media (min-width: 720px) and (max-width: 1179px) {
		aside {
			padding: 18px var(--space-5) 20px;
			align-items: center;
			gap: var(--space-7);
		}
		.brand {
			flex-direction: column;
			gap: var(--space-5);
		}
		.wordmark,
		.hero,
		.label,
		.theme-label,
		.who,
		.install,
		.sign-out {
			display: none;
		}
		.settings {
			margin-left: 0;
		}
		nav {
			gap: var(--space-3);
			width: 100%;
			align-items: center;
		}
		.nav-item {
			grid-template-columns: 44px;
			justify-content: center;
			height: 44px;
			width: 44px;
			padding: 0;
		}
		.nav-tile {
			width: 44px;
			height: 44px;
			border-radius: var(--radius-xl);
		}
		/* Pinned to the tile's corner rather than sitting in a column of its
		   own, which the rail has taken away. */
		.badge {
			position: absolute;
			top: 4px;
			right: 4px;
		}
		.foot {
			width: 100%;
			align-items: center;
			gap: var(--space-6);
		}
		.themes {
			flex-direction: column;
			gap: var(--space-1);
		}
		.themes button {
			padding: var(--space-3);
		}
		.person {
			padding: 0;
		}
		.avatar {
			width: 32px;
			height: 32px;
		}
	}
</style>
