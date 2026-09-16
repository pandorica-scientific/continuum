<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import Sidebar from '$lib/components/Sidebar.svelte';
	import BottomBar from '$lib/components/BottomBar.svelte';
	import BrandMark from '$lib/components/BrandMark.svelte';
	import IconTile from '$lib/components/IconTile.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import FileViewer from '$lib/components/FileViewer.svelte';
	import type { ViewerSource } from '$lib/ui/file-viewer';
	import type { IconName } from '$lib/icons';
	import { overlayFocus } from '$lib/actions/overlay';
	import { filePreview } from '$lib/actions/file-preview';

	let { data, children } = $props();

	let drawerOpen = $state(false);

	// Every `/files/…` link opens here instead of a browser tab, wired once on the shell.
	let openFile = $state<{ source: ViewerSource; title: string } | null>(null);

	let quickPinned = $state(false);
	let quickHovering = $state(false);
	const quickOpen = $derived(quickPinned || quickHovering);

	// What "add" can mean right now. Every entry is gated on its module, so the
	// menu never offers a screen that would 404.
	const quickAdds = $derived(
		[
			// Hue matches the area it leads to, e.g. teal for the Assets row.
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
			// The two Money screens that are filed rather than imported; both open their form on arrival.
			data.modules.salary
				? { href: '/salary?add=1', label: 'Payslip', icon: 'wallet' as IconName, hue: 'teal' }
				: null,
			data.modules.tax
				? { href: '/tax?add=1', label: 'Tax statement', icon: 'receipt' as IconName, hue: 'teal' }
				: null
		].filter((item) => item !== null)
	);
</script>

<a class="skip-link" href="#content">Skip to content</a>
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
			netWorthDeltaShare={data.netWorthDeltaShare}
			baseCurrency={data.baseCurrency}
			importBadge={data.importBadge}
			approximateRates={data.missingRates.none.length > 0}
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

	<main id="content" tabindex="-1">
		<!-- Brand mark shown only on phone, where the sidebar is a drawer. -->
		<div class="phone-brand">
			<span class="phone-mark"><BrandMark size={18} /></span>
			<span class="phone-word">Continuum</span>
		</div>
		<!-- Open-instance banner lives in Settings and on sign-in, not here — a
		     warning on every screen forever goes unread. -->
		{@render children()}
	</main>

	<BottomBar
		modules={data.modules}
		importBadge={data.importBadge}
		{drawerOpen}
		onopen={() => (drawerOpen = true)}
	/>

	{#if quickAdds.length > 0}
		<!-- Opens on hover and on click: no hover on a phone, and a keyboard user never triggers one. -->
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
			<!-- Rotation on the wrapper, scale on the button, so open and hover can both apply at once. -->
			<span class="quick-spin" class:open={quickOpen}>
				<button
					type="button"
					class="quick-add"
					aria-label="Quick add"
					aria-expanded={quickOpen}
					onclick={() => (quickPinned = !quickPinned)}
				>
					<Icon name="plus" size={20} />
				</button>
			</span>
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
	/* Three layouts, one markup: only the columns change (264px sidebar, 76px
	   rail, or none on phone where `.side` becomes a drawer). */
	.shell {
		display: grid;
		grid-template-columns: 264px minmax(0, 1fr);
		min-height: 100vh;
		align-items: start;
	}

	/* Sticky, not in-flow, so nav doesn't scroll away on short viewports.
	   `align-items: start` on the grid is what lets a sticky element work here. */
	.side {
		position: sticky;
		top: 0;
		/* dvh, not vh: mobile browser chrome changes vh's viewport, which would
		   overflow the sidebar below the fold. Scrolling belongs to the inner aside. */
		height: 100dvh;
	}
	main {
		padding: 26px 32px 60px;
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
		min-width: 0;
		/* Runs once per mount, since SvelteKit remounts the page component on navigation. */
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

	.quick-spin {
		display: block;
		transition: transform var(--dur) var(--ease);
	}
	/* The plus becomes the ✕ that closes it. One glyph, rotated, rather than a
	   second icon swapped in — the rotation says the two are the same control. */
	.quick-spin.open {
		transform: rotate(45deg);
	}
	/* Small at rest, full size under the pointer, so it doesn't sit over a
	   table's last row or the Documents rail corner until reached for. */
	.quick-add {
		display: grid;
		place-items: center;
		border: none;
		cursor: pointer;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-pill);
		background: var(--brand);
		box-shadow: var(--shadow-hero);
		color: #fff;
		transform: scale(1);
		transition:
			transform var(--dur) var(--ease),
			filter var(--dur) var(--ease);
	}
	.quick-add:hover,
	.quick-add:focus-visible,
	.quick-spin.open .quick-add {
		text-decoration: none;
		transform: scale(1.45);
		filter: brightness(1.1);
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
			/* A transformed element is still tabbable/exposed to a11y tools; visibility fixes that. */
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
		/* No hover on a phone, so it never grows: full size at rest instead,
		   and still clear of the bottom bar. */
		.quick-add {
			width: 46px;
			height: 46px;
			transform: none;
		}
	}
</style>
