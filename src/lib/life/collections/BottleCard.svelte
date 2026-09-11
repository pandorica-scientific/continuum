<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * One bottling in the grid.
	 *
	 * A row is not one physical bottle, so the card carries a count as well as a
	 * state: "3 sealed, 1 open" is a different evening from "4 sealed".
	 */
	import { drinkPhase, phaseHue, phaseWord } from '$lib/life/collections/drink-by';
	import { stateOf } from '$lib/life/collections/ownership';
	import { typeWord } from '$lib/life/collections/types';
	import BottleArt from '$lib/life/collections/BottleArt.svelte';
	import type { EnumValue } from '$lib/enums';

	interface Props {
		href: string;
		type: EnumValue<'bottle.type'>;
		producer: string;
		name: string;
		vintage: number | null;
		ageYears: number | null;
		region: string;
		abv: string | null;
		drinkFrom: number | null;
		drinkTo: number | null;
		owned: number;
		opened: number;
		score: number | null;
		art: string | null;
		initials: string;
		labelPhoto: string | null;
		/** The year to judge the drink-by window against. Passed in, never `new Date()`. */
		year: number;
	}

	let {
		href,
		type,
		producer,
		name,
		vintage,
		ageYears,
		region,
		abv,
		drinkFrom,
		drinkTo,
		owned,
		opened,
		score,
		art,
		initials,
		labelPhoto,
		year
	}: Props = $props();

	const state = $derived(stateOf({ owned, opened }));
	const phase = $derived(drinkPhase({ drinkFrom, drinkTo }, year));

	/** region · vintage · ABV, with whichever of them exist. */
	const facts = $derived(
		[region, vintage ? String(vintage) : ageYears ? `${ageYears} year` : '', abv ? `${abv}%` : '']
			.map((part) => part.trim())
			.filter(Boolean)
	);
</script>

<a class="bottle" {href}>
	<BottleArt {art} {type} {initials} {vintage} {labelPhoto} {name} />

	<div class="body">
		<h3>
			<span class="name">{name}</span>
			{#if score !== null}<span class="score mono">{score}</span>{/if}
		</h3>
		{#if producer}<p class="producer">{producer}</p>{/if}

		{#if facts.length}
			<p class="facts">
				{#each facts as fact, at (fact)}
					{#if at > 0}<span class="dot" aria-hidden="true">·</span>{/if}<span class="mono"
						>{fact}</span
					>
				{/each}
			</p>
		{/if}

		<div class="pills">
			<span class="pill state {state.kind}">{state.label}</span>
			{#if owned > 1}<span class="pill count mono">×{owned}</span>{/if}
			<!-- A bottle with no window says nothing at all. Without this gate a
			     bottle of gin gets told to drink soon inside a window that does
			     not exist. -->
			{#if phase !== 'keeps'}
				<span class="pill phase" style:--ink="var({phaseHue(phase)})">{phaseWord(phase)}</span>
			{/if}
		</div>

		<span class="type">{typeWord(type)}</span>
	</div>
</a>

<style>
	.bottle {
		display: flex;
		flex-direction: column;
		width: 268px;
		height: 100%;
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		background: var(--card);
		overflow: hidden;
		color: inherit;
	}
	.bottle:hover {
		text-decoration: none;
		background: var(--surface-2);
	}
	/* The divider sits directly beneath the art, as the handoff draws it — the
	   bottle rests on the line rather than floating above a gap. */
	.bottle :global(.art) {
		border-bottom: 1px solid var(--bd);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-6) 14px 14px;
		flex: 1;
	}
	h3 {
		display: flex;
		align-items: baseline;
		gap: var(--space-4);
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
	}
	.name {
		flex: 1;
		min-width: 0;
	}
	.score {
		flex: none;
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.producer {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.facts {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.dot {
		margin: 0 var(--space-3);
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-top: auto;
		padding-top: var(--space-5);
	}
	.pill {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		white-space: nowrap;
	}
	.state {
		background: var(--surface-2);
		color: var(--fg2);
	}
	.state.open,
	.state.some-open {
		background: var(--rose-tint);
		color: var(--rose);
	}
	.state.finished {
		color: var(--fg3);
	}
	/* Impossible counts are shown, not hidden: a clamp hides the bug it covers. */
	.state.impossible {
		background: var(--red-tint);
		color: var(--red);
	}
	.count {
		background: var(--surface-2);
		color: var(--fg3);
	}
	.phase {
		border: 1px solid color-mix(in srgb, var(--ink) 40%, transparent);
		color: color-mix(in srgb, var(--ink) 72%, var(--fg1));
	}
	.type {
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--fg3);
	}
</style>
