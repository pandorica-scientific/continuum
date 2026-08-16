<script lang="ts">
	import { onMount } from 'svelte';
	import { ERROR_STATES, NOTES, huesFor, isGenericMessage, stateFor } from '$lib/errors/states';
	import { MOTIFS } from '$lib/errors/motifs';

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

	// A page rendered from cache while the server is unreachable is not a 500,
	// whatever status it arrived with — the useful thing to say is "you cannot
	// reach the server", so the offline state replaces whatever we were given.
	// Client-only: the server obviously always thinks it is reachable.
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

	// The thrown message says what went wrong for THIS request and beats the
	// catalogue's sentence about the class of problem. SvelteKit's stand-in
	// messages ("Not Found") say less than the catalogue does, so they lose.
	const body = $derived(!offline && !isGenericMessage(message) ? message! : screen.body);

	// Stamped on the client, so the server and the browser cannot disagree about
	// the time — rendering it during SSR would be a hydration mismatch on every
	// error page. Once, on mount: this is when the screen was seen, and it must
	// not tick while somebody is reading it off to a colleague.
	let stamp = $state<string | null>(null);
	onMount(() => {
		stamp = new Date().toLocaleString();
	});

	const EGG_KEY = 'continuum-error-eggs';
	let open = $state(false);

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

	const motif = $derived(MOTIFS[screen.code] ?? []);
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

			<!-- Facts, not decoration: every line here is something the server or
			     the browser actually reported, because these are what someone
			     quotes when they report the problem. -->
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
				title={open ? 'Back to the rings' : 'Something is in the rings'}
				aria-label={open ? 'Back to the rings' : 'Something is in the rings'}
				style:color={hues.hue}
			>
				{#if open}
					<svg
						viewBox="0 0 340 340"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						{#each motif as m, i (i)}
							<path
								d={m.d}
								stroke-width={m.w}
								opacity={m.o}
								stroke-dasharray={m.dash ?? 'none'}
								transform="rotate({m.rot ?? 0} 170 170)"
							/>
						{/each}
					</svg>
				{:else}
					<svg
						viewBox="0 0 340 340"
						fill="none"
						stroke="currentColor"
						stroke-linecap="round"
						aria-hidden="true"
					>
						<path d="M150 136 A34 34 0 0 1 150 204" stroke-width="7" opacity="0.95" />
						<path d="M150 110 A60 60 0 0 1 150 230" stroke-width="6.4" opacity="0.68" />
						<path d="M150 84 A86 86 0 0 1 150 256" stroke-width="5.8" opacity="0.47" />
						<path d="M150 58 A112 112 0 0 1 150 282" stroke-width="5.2" opacity="0.32" />
						<path d="M150 32 A138 138 0 0 1 150 308" stroke-width="4.6" opacity="0.2" />
						<path d="M150 6 A164 164 0 0 1 150 334" stroke-width="4" opacity="0.11" />
						<circle cx="150" cy="170" r="6" fill="currentColor" stroke="none" />
					</svg>
					<span class="mark-code">{screen.code}</span>
				{/if}
			</button>

			{#if open && NOTES[screen.code]}
				<p class="note" style:color={hues.hue}>
					<span aria-hidden="true">&rsaquo;</span>
					<span>{NOTES[screen.code]}</span>
				</p>
			{/if}
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

	/* The design set these 56px apart in a 1080px grid of equal fractions, so the
	   mark drifted to the far right while the sentence — capped at 46ch — ended
	   well short of it, and the two read as separate things. Sizing both tracks
	   to their content and centring the pair is what actually closes the gap: a
	   fractional column would just re-open it on a wider screen. */
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
		border-radius: 12px;
		padding: 4px 13px;
		font-family: var(--font-mono);
		font-size: 11.5px;
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
		gap: 10px;
		flex-wrap: wrap;
	}

	.actions a {
		border-radius: 8px;
		padding: 10px 18px;
		font-size: 13.5px;
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
		font-size: 11.5px;
		color: var(--fg3);
	}

	.tech:empty {
		display: none;
	}

	.mark-col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}

	.mark {
		position: relative;
		width: clamp(190px, 24vw, 310px);
		/* The drawing is right-biased inside its square: the arcs open rightward
		   from x=150 of a 340 box, so the left ~42% of the mark is empty. Closing
		   the gap in the grid alone does nothing about that — it moves an empty
		   column closer. This pulls the square itself left so the INK lands where
		   the eye expects it, which is what "closer to the text" means. */
		margin-inline-start: clamp(-104px, -7vw, -36px);
		aspect-ratio: 1 / 1;
		display: grid;
		place-items: center;
		border: none;
		background: none;
		padding: 0;
		cursor: pointer;
	}

	.mark svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.mark-code {
		position: relative;
		font-family: var(--font-mono);
		font-size: clamp(46px, 9vw, 74px);
		font-weight: 600;
		letter-spacing: -0.03em;
		color: var(--fg1);
		/* The rings pass behind the digits; the halo is what keeps them legible
		   where a stroke crosses a numeral. */
		text-shadow:
			0 0 14px var(--bg),
			0 0 14px var(--bg),
			0 0 8px var(--bg),
			0 0 4px var(--bg);
	}

	.note {
		margin: 0;
		display: flex;
		align-items: flex-start;
		gap: 9px;
		max-width: 34ch;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.55;
		text-align: left;
	}

	.note span:first-child {
		flex: 0 0 auto;
		opacity: 0.7;
	}

	/* On a phone the mark goes ABOVE the sentence rather than beside or below
	   it: side by side there is no room for either, and underneath it is the
	   first thing scrolled off. */
	@media (max-width: 720px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
			gap: 18px;
			justify-items: stretch;
		}

		.mark-col {
			order: -1;
		}

		.mark {
			width: min(220px, 30vh);
			/* Centred above the text here, so the crop-correction would only push
			   it off-centre. */
			margin-inline-start: 0;
		}

		h1 {
			max-width: none;
		}
	}
</style>
