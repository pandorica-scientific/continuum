<script lang="ts" module>
	import { renderIcon } from '$lib/life/art/stamps/index.mjs';
	import { assertInertSvg } from '$lib/life/art';

	/** One symbol at chip size, inked from the context like everything else. */
	export function symbolSvg(id: string): string {
		try {
			return assertInertSvg(renderIcon(id, 'currentColor'));
		} catch {
			return '';
		}
	}
</script>

<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The stamp, drawn while you type, with a say in how it turns out.
	 *
	 * The generator is pure and has no dependencies, so it runs in the browser
	 * exactly as it does on the server — which means the household can see the
	 * drawing before committing to it rather than finding out afterwards.
	 * Whatever is on screen is posted back in a hidden field and stored as-is,
	 * so what was previewed is what is kept.
	 *
	 * Three controls, in the order somebody reaches for them:
	 *
	 * - **nothing at all** — typing a name and a country is usually enough, and
	 *   a recognised place brings its own landmark
	 * - **Try another** — same place, different composition: border, layout,
	 *   ink and motif. For when the drawing is right and the frame is not
	 * - **the symbol row** — pick the picture outright, when the household
	 *   disagrees with what was chosen
	 *
	 * The server does not trust any of it: `parseStoredStamp` re-renders what
	 * arrives, which runs the inertness check, and falls back to resolving one
	 * itself if anything is off.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import { resolveStamp, stampSvg, stampSymbolChoices, type ArtDefinition } from '$lib/life/art';

	let {
		name,
		country = '',
		city = '',
		/** The field the definition is posted back in. */
		field = 'art'
	}: {
		name: string;
		country?: string;
		city?: string;
		field?: string;
	} = $props();

	/** Set by "Try another"; cleared whenever the place itself changes. */
	let seed = $state<number | undefined>(undefined);
	/** Set by the symbol row; likewise cleared when the place changes. */
	let icon = $state<string | undefined>(undefined);
	let picking = $state(false);

	const subject = $derived({
		name: name.trim() || 'Somewhere',
		country: country.trim() || null,
		city: city.trim() || null
	});

	// Typing a new place throws away both overrides: a symbol chosen for Porto
	// is not a symbol chosen for Kyoto, and silently keeping it would be the app
	// arguing with what was just typed.
	let lastPlace = $state('');
	$effect(() => {
		const place = `${subject.name}|${subject.country}|${subject.city}`;
		if (place === lastPlace) return;
		lastPlace = place;
		seed = undefined;
		icon = undefined;
	});

	const definition = $derived.by((): ArtDefinition | null => {
		try {
			return resolveStamp(subject, { seed, icon });
		} catch {
			return null;
		}
	});

	const svg = $derived.by(() => {
		if (!definition) return null;
		try {
			return stampSvg(definition);
		} catch {
			return null;
		}
	});

	const choices = $derived(stampSymbolChoices(subject));
</script>

<div class="picker">
	<div class="preview" aria-live="polite">
		{#if svg}
			<!-- Checked, not trusted: `assertInertSvg` runs inside `stampSvg` and
			     refuses a drawing carrying a script, a handler or an external
			     reference. See $lib/life/art. -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html svg}
		{:else}
			<span class="none">No stamp yet</span>
		{/if}
	</div>

	<div class="controls">
		<span class="caption">Drawn from the name and the country.</span>
		<div class="buttons">
			<button
				class="link"
				type="button"
				onclick={() => (seed = Math.floor(Math.random() * 4_294_967_295))}
			>
				<Icon name="rotate" size={14} /> Try another
			</button>
			<button
				class="link"
				type="button"
				onclick={() => (picking = !picking)}
				aria-expanded={picking}
			>
				<Icon name="pencil" size={14} />
				{picking ? 'Done' : 'Pick the picture'}
			</button>
		</div>
	</div>

	{#if picking}
		<div class="symbols" role="group" aria-label="Choose a symbol">
			{#each choices as choice (choice.id)}
				<button
					class="symbol"
					class:chosen={icon === choice.id}
					type="button"
					title={choice.label}
					aria-label={choice.label}
					aria-pressed={icon === choice.id}
					onclick={() => (icon = icon === choice.id ? undefined : choice.id)}
				>
					<!-- Same rule as the preview above: `assertInertSvg` has already
					     refused anything that could execute. -->
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html symbolSvg(choice.id)}
				</button>
			{/each}
		</div>
	{/if}

	{#if definition}
		<input type="hidden" name={field} value={JSON.stringify(definition)} />
	{/if}
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-6) 18px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--rose-wash);
	}
	.preview {
		display: grid;
		place-items: center;
		height: 132px;
		color: var(--rose);
	}
	.preview :global(svg) {
		width: 124px;
		height: 124px;
	}
	.none {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	.caption {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.buttons {
		display: flex;
		gap: var(--space-6);
	}
	.link {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		min-height: auto;
		padding: 0;
		border: 0;
		background: none;
		font-size: var(--text-sm);
		color: var(--blue);
	}
	.link:hover {
		text-decoration: underline;
	}
	.symbols {
		display: grid;
		grid-template-columns: repeat(auto-fill, 40px);
		gap: var(--space-3);
		justify-content: start;
		padding-top: var(--space-3);
	}
	.symbol {
		width: 40px;
		height: 40px;
		min-height: auto;
		display: grid;
		place-items: center;
		padding: 0;
		border: 1px solid var(--bd);
		border-radius: var(--radius-ctl);
		background: var(--card);
		color: var(--fg2);
	}
	.symbol :global(svg) {
		width: 22px;
		height: 22px;
	}
	.symbol:hover {
		border-color: var(--bd2);
		color: var(--fg1);
	}
	.symbol.chosen {
		border-color: color-mix(in srgb, var(--rose) 55%, transparent);
		background: var(--rose-tint);
		color: var(--rose);
	}
</style>
