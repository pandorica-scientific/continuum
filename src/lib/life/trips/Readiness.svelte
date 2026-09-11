<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Can everyone actually get in?
	 *
	 * One line per person going: their passport, then where it lets them in for
	 * each country the trip visits. Read out of the archive rather than typed
	 * into the trip — the wallet already holds every passport.
	 *
	 * Every pill carries a WORD as well as a colour. A household of two whose
	 * members cannot tell green from amber still has to be able to read this,
	 * and this is the screen where being unable to is expensive.
	 */
	import Pill from '$lib/components/Pill.svelte';
	import PersonTag from '$lib/components/PersonTag.svelte';
	import { countryFlag, countryName } from '$lib/life/geo/countries';
	import {
		PASSPORT_HUE,
		PASSPORT_WORDING,
		VISA_HUE,
		VISA_WORDING,
		type PassportState,
		type VisaPosition
	} from '$lib/life/readiness';

	interface Line {
		personId: string;
		name: string;
		passportCountry: string | null;
		passport: PassportState;
		visas: { country: string; position: VisaPosition }[];
	}

	let {
		lines,
		hues,
		/** Built from `VISA_AS_OF`, never written here. */
		caption
	}: {
		lines: Line[];
		hues: Record<string, string>;
		caption: string;
	} = $props();
</script>

{#if lines.length}
	<!-- One grid for every line, not a flex row per person.
	     A row of its own sizes its columns to its own contents, so "Jana
	     Nováková" pushed her passport pill further right than "Petr Novák" did
	     and nothing lined up down the block. As one grid, `max-content` is the
	     widest cell in that column across ALL rows — which is what makes three
	     columns read as three columns. -->
	<div class="readiness">
		<div class="grid">
			{#each lines as line (line.personId)}
				<span class="who">
					<PersonTag name={line.name} hue={hues[line.personId] ?? '--fg3'} />
				</span>

				<span class="cell">
					<Pill hue={PASSPORT_HUE[line.passport]}>
						{PASSPORT_WORDING[line.passport]}
					</Pill>
				</span>

				<span class="cell visas">
					{#each line.visas as visa (visa.country)}
						<Pill hue={VISA_HUE[visa.position]}>
							<span aria-hidden="true">{countryFlag(visa.country)}</span>
							{countryName(visa.country)}: {VISA_WORDING[visa.position]}
						</Pill>
					{/each}
				</span>
			{/each}
		</div>

		<!-- The date is the only promise this block makes, so it is never far
		     from the answers it qualifies. -->
		<p class="caption">{caption}</p>
	</div>
{:else}
	<p class="caption">Nobody is down as going yet.</p>
{/if}

<style>
	.readiness {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.grid {
		display: grid;
		grid-template-columns: max-content max-content minmax(0, 1fr);
		align-items: center;
		gap: var(--space-4) var(--space-5);
	}
	.who,
	.cell {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.visas {
		gap: var(--space-3);
		flex-wrap: wrap;
	}

	/* One column per person on a phone: three columns of pills at 400px is
	   three columns of wrapped text. */
	@media (max-width: 719px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-3);
		}
		.who {
			padding-top: var(--space-4);
		}
		.who:first-child {
			padding-top: 0;
		}
	}
	.caption {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
