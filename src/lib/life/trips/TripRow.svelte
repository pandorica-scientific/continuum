<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * One booked trip, as a wide row.
	 *
	 * A row rather than a card because an upcoming trip is read left to right —
	 * where, when, who, is everyone ready — and there are never many of them.
	 */
	import PersonTag from '$lib/components/PersonTag.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import { countryFlag } from '$lib/life/geo/countries';
	import type { Hue } from '$lib/ui/hue';

	interface Member {
		id: string;
		name: string;
		initials: string;
	}

	let {
		href,
		name,
		emoji,
		destinations,
		startsOn,
		endsOn,
		nights,
		members,
		hues,
		readiness
	}: {
		href: string;
		name: string;
		emoji: string;
		destinations: { country: string; label: string }[];
		startsOn: string;
		endsOn: string;
		nights: number;
		members: Member[];
		hues: Record<string, string>;
		/** Green ready, yellow something expires too soon, red something is wrong. */
		readiness?: { hue: Hue; label: string };
	} = $props();

	const dates = $derived(`${startsOn} → ${endsOn}`);
</script>

<a class="trip card" {href}>
	<div class="head">
		<h3>
			{#if emoji}<span class="emoji" aria-hidden="true">{emoji}</span>{/if}
			{name}
		</h3>
		<span class="where">
			{#each destinations as destination, i (destination.label)}
				{#if i > 0}<span class="dot" aria-hidden="true">·</span>{/if}
				<span class="flag" aria-hidden="true">{countryFlag(destination.country)}</span>
				{destination.label}
			{/each}
		</span>
	</div>

	<div class="facts">
		<span class="dates mono">{dates}</span>
		<span class="nights"><span class="mono">{nights}</span> nights</span>
	</div>

	<div class="who">
		{#each members as member (member.id)}
			<PersonTag name={member.name} hue={hues[member.id] ?? '--fg3'} compact />
		{/each}
		{#if readiness}
			<Pill hue={readiness.hue}>{readiness.label}</Pill>
		{/if}
	</div>
</a>

<style>
	/* Fixed tracks, not `auto`.
	   Each row is its own grid, so `auto` columns size to that row's contents —
	   and a trip with one traveller then puts its dates in a different place
	   from a trip with two. The dates and the people line up down the list
	   because these two tracks are the same width on every row whatever is in
	   them. */
	.trip {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 200px 148px;
		align-items: center;
		gap: var(--space-5) 18px;
		padding: 14px 18px;
		color: inherit;
	}
	.trip:hover {
		background: var(--surface-2);
		text-decoration: none;
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	h3 {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		font-size: var(--text-lg);
		font-weight: 600;
		color: var(--fg1);
	}
	.emoji {
		flex: none;
	}
	.where {
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.dot {
		margin: 0 var(--space-2);
	}
	.facts {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--fg2);
		white-space: nowrap;
	}
	.nights {
		color: var(--fg3);
	}
	.who {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	/* One column on a phone: three columns of this at 400px is three columns of
	   nothing. */
	@media (max-width: 719px) {
		.trip {
			grid-template-columns: minmax(0, 1fr);
		}
		.facts {
			align-items: flex-start;
			flex-direction: row;
			gap: var(--space-5);
		}
		.who {
			justify-content: flex-start;
		}
	}
</style>
