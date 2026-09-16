<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { onMount } from 'svelte';
	import { ERROR_STATES, NOTES, huesFor, isGenericMessage, stateFor } from '$lib/errors/states';
	import { ARTWORK_SIZE, artworkFor } from '$lib/errors/artwork';

	let {
		status,
		message = undefined,
		reference = undefined,
		path = undefined
	}: {
		status: number;
		message?: string;
		reference?: string;
		path?: string;
	} = $props();

	// A page served from cache while offline isn't really a 500 — the offline
	// state replaces whatever status was given. Client-only check.
	let offline = $state(false);
	$effect(() => {
		const read = () => (offline = navigator.onLine === false);
		read();
		addEventListener('online', read);
		addEventListener('offline', read);
		return () => {
			removeEventListener('online', read);
			removeEventListener('offline', read);
		};
	});

	const screen = $derived(offline ? ERROR_STATES.find((s) => s.code === '000')! : stateFor(status));
	const hues = $derived(huesFor(screen));

	// A specific thrown message beats the catalogue's generic sentence, but
	// SvelteKit's stand-in messages ("Not Found") lose to the catalogue.
	const body = $derived(!offline && !isGenericMessage(message) ? message! : screen.body);

	// Stamped client-side only (SSR would cause a hydration mismatch), once on
	// mount so it doesn't tick while someone reads it.
	let stamp = $state<string | null>(null);
	onMount(() => {
		stamp = new Date().toLocaleString();
	});

	const EGG_KEY = 'continuum-error-eggs';
	let open = $state(false);

	const artwork = $derived(artworkFor(screen.code));
	const label = $derived(
		open ? `Hide ${screen.code} illustration` : `Reveal ${screen.code} illustration`
	);

	function toggleEgg() {
		if (!open) {
			try {
				const found = JSON.parse(localStorage.getItem(EGG_KEY) ?? '{}');
				found[screen.code] = true;
				localStorage.setItem(EGG_KEY, JSON.stringify(found));
			} catch {
				// A browser refusing storage is not a reason to withhold the drawing.
			}
		}
		open = !open;
	}

	// Prefetch on hover/focus rather than on mount, so revealing the (large)
	// drawing is instant without downloading it for everyone who never clicks.
	let warmed = '';
	function warm() {
		if (warmed === artwork) return;
		warmed = artwork;
		new Image().src = artwork;
	}
</script>

<div class="screen">
	<div class="layout">
		<div class="text-col">
			<span
				class="badge"
				style:color={hues.hue}
				style:border-color={hues.hue}
				style:background={hues.tint}
			>
				<span>{screen.code}</span>
				<span class="badge-name">{screen.name}</span>
			</span>

			<h1>{screen.title}</h1>
			<p class="body">{body}</p>

			<div class="actions">
				<a class="primary" href={screen.primary.href}>{screen.primary.label}</a>
				{#if screen.secondary}
					<a class="secondary" href={screen.secondary.href}>{screen.secondary.label}</a>
				{/if}
			</div>

			<!-- Facts, not decoration: what someone would quote reporting the problem. -->
			<div class="tech">
				{#if reference}<span>ref {reference}</span>{/if}
				{#if path}<span>{path}</span>{/if}
				{#if stamp}<span>{stamp}</span>{/if}
			</div>
		</div>
		<div class="mark-col">
			<button
				type="button"
				class="mark"
				onclick={toggleEgg}
				onpointerenter={warm}
				onfocus={warm}
				title={label}
				aria-label={label}
				aria-pressed={open}
				style:color={hues.hue}
			>
				{#if open}
					<!-- White line art used as a luminance mask over a solid fill, so
					     the ink takes the state's hue. Blurred copy underneath is the glow. -->
					<svg
						data-error-artwork
						class="art"
						viewBox="0 0 {ARTWORK_SIZE} {ARTWORK_SIZE}"
						aria-hidden="true"
					>
						<defs>
							<filter id="error-art-glow" x="-18%" y="-18%" width="136%" height="136%">
								<feGaussianBlur stdDeviation="12" />
							</filter>
							<mask id="error-art-mask" style="mask-type: luminance;">
								<image
									href={artwork}
									x="0"
									y="0"
									width={ARTWORK_SIZE}
									height={ARTWORK_SIZE}
									preserveAspectRatio="xMidYMid meet"
								/>
							</mask>
						</defs>
						<rect
							x="0"
							y="0"
							width={ARTWORK_SIZE}
							height={ARTWORK_SIZE}
							fill="currentColor"
							opacity="0.34"
							mask="url(#error-art-mask)"
							filter="url(#error-art-glow)"
						/>
						<rect
							x="0"
							y="0"
							width={ARTWORK_SIZE}
							height={ARTWORK_SIZE}
							fill="currentColor"
							mask="url(#error-art-mask)"
						/>
					</svg>
				{:else}
					<svg data-error-logo class="logo" viewBox="0 0 56 56" aria-hidden="true">
						<defs>
							<filter id="error-logo-glow" x="-60%" y="-60%" width="220%" height="220%">
								<feGaussianBlur stdDeviation="1.8" />
							</filter>
						</defs>
						<g
							fill="none"
							stroke="currentColor"
							stroke-width="2.2"
							stroke-linecap="round"
							opacity="0.34"
							filter="url(#error-logo-glow)"
						>
							<path d="M18 18 A10 10 0 0 1 18 38" />
							<path d="M18 10 A18 18 0 0 1 18 46" />
							<path d="M18 3 A25 25 0 0 1 18 53" />
							<circle cx="18" cy="28" r="2.8" fill="currentColor" stroke="none" />
						</g>
						<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
							<path d="M18 18 A10 10 0 0 1 18 38" />
							<path d="M18 10 A18 18 0 0 1 18 46" />
							<path d="M18 3 A25 25 0 0 1 18 53" />
							<circle cx="18" cy="28" r="2.8" fill="currentColor" stroke="none" />
						</g>
					</svg>
				{/if}
			</button>

			<!-- Fixed-height box so revealing the drawing doesn't shift the page. -->
			<div class="note-slot">
				{#if open && NOTES[screen.code]}
					<p class="note" style:color={hues.hue}>
						<span aria-hidden="true">&rsaquo;</span>
						<span>{NOTES[screen.code]}</span>
					</p>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.screen {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(28px, 6vh, 64px) clamp(20px, 5vw, 48px);
		background: linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
		background-attachment: fixed;
	}

	/* Both columns sized to content and centred, rather than a fractional grid,
	   so the text and mark stay close together at any width. */
	.layout {
		max-width: 100%;
		display: grid;
		grid-template-columns: minmax(0, auto) auto;
		gap: clamp(16px, 3vw, 40px);
		justify-content: center;
		align-items: center;
	}

	.text-col {
		display: flex;
		flex-direction: column;
		gap: 20px;
		min-width: 0;
	}

	.badge {
		display: inline-flex;
		align-self: flex-start;
		align-items: center;
		gap: 9px;
		border: 1px solid;
		border-radius: var(--radius-xl);
		padding: 4px 13px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.badge-name {
		opacity: 0.7;
	}

	h1 {
		margin: 0;
		font-size: clamp(27px, 3.4vw, 40px);
		font-weight: 600;
		letter-spacing: -0.025em;
		line-height: 1.14;
		text-wrap: pretty;
		max-width: 19ch;
	}

	.body {
		margin: 0;
		font-size: clamp(14.5px, 1.15vw, 16px);
		color: var(--fg2);
		line-height: 1.6;
		max-width: 46ch;
		text-wrap: pretty;
	}

	.actions {
		display: flex;
		gap: var(--space-5);
		flex-wrap: wrap;
	}

	.actions a {
		border-radius: var(--radius-md);
		padding: 10px 18px;
		font-size: var(--text-md);
		text-decoration: none;
	}

	.actions a:hover {
		text-decoration: none;
	}

	.primary {
		border: 1px solid var(--brand);
		background: var(--brand);
		color: var(--fg-inverse);
		font-weight: 500;
	}

	.primary:hover {
		color: var(--fg-inverse);
		opacity: 0.9;
	}

	.secondary {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
	}

	.secondary:hover {
		color: var(--fg1);
		background: var(--card2);
	}

	.tech {
		border-top: 1px solid var(--bd);
		padding-top: 15px;
		display: flex;
		flex-wrap: wrap;
		gap: 6px 20px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--fg3);
	}

	.tech:empty {
		display: none;
	}

	.mark-col {
		width: min(420px, 46vh);
		max-width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-6);
		min-width: 0;
	}

	/* Both states fill the same square so revealing the drawing is a redraw,
	   not a resize; rings sit at 78% since the drawings are full-bleed. */
	.mark {
		width: 100%;
		aspect-ratio: 1 / 1;
		display: grid;
		place-items: center;
		border: none;
		background: none;
		padding: 0;
		margin: 0;
		color: inherit;
		cursor: pointer;
	}

	.mark:focus-visible {
		border-radius: 18px;
		outline: 2px solid currentColor;
		outline-offset: 8px;
	}

	.logo {
		width: 78%;
		height: 78%;
		display: block;
		overflow: visible;
	}

	.art {
		width: 100%;
		height: 100%;
		display: block;
		overflow: visible;
		transform-origin: 50% 50%;
		animation: art-drift 9s ease-in-out infinite;
	}

	@keyframes art-drift {
		0%,
		100% {
			transform: translateY(0) rotate(-0.25deg);
		}
		50% {
			transform: translateY(-7px) rotate(0.25deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.art {
			animation: none;
		}
	}

	.note-slot {
		width: 100%;
		height: 3.2em;
		display: flex;
		align-items: flex-start;
		justify-content: center;
	}

	.note {
		margin: 0;
		display: flex;
		align-items: flex-start;
		gap: 9px;
		max-width: 34ch;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		line-height: 1.55;
		text-align: left;
	}

	.note span:first-child {
		flex: 0 0 auto;
		opacity: 0.7;
	}

	/* On a phone the mark goes above the sentence: side by side there's no
	   room, and below it would be scrolled off first. */
	@media (max-width: 720px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
			gap: 18px;
			justify-items: stretch;
		}

		.mark-col {
			order: -1;
			width: min(260px, 34vh);
			align-self: center;
		}

		h1 {
			max-width: none;
		}
	}
</style>
