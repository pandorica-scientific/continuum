<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * Every time somebody opened this bottle and said something about it.
	 *
	 * Newest first, because the last opinion is the one being checked against.
	 * The flavour chips carry their own series colours so the same word is the
	 * same colour here and on the radar above.
	 */
	import { enhance } from '$app/forms';
	import PersonTag from '$lib/components/PersonTag.svelte';
	import Icon from '$lib/components/Icon.svelte';

	interface Tasting {
		id: string;
		tastedOn: string;
		score: number | null;
		note: string;
		personId: string | null;
		personName: string | null;
		notes: { id: string; note: string; series: string }[];
	}

	let {
		tastings,
		hues
	}: {
		tastings: Tasting[];
		/** person id → a `--series-…` token, from `personHues`. */
		hues: Record<string, string>;
	} = $props();
</script>

{#if tastings.length}
	<ul class="tastings">
		{#each tastings as one (one.id)}
			<li>
				<div class="head">
					<span class="when mono">{one.tastedOn}</span>
					{#if one.personName}
						<PersonTag
							name={one.personName}
							hue={hues[one.personId ?? ''] ?? '--series-1'}
							compact
						/>
					{/if}
					{#if one.score !== null}<span class="score mono">{one.score}</span>{/if}
					<form
						method="POST"
						action="?/deleteTasting"
						use:enhance={({ cancel }) => {
							if (!confirm('Delete this tasting?')) cancel();
							return async ({ update }) => update();
						}}
					>
						<input type="hidden" name="tastingId" value={one.id} />
						<button class="drop" type="submit" aria-label="Delete this tasting">
							<Icon name="plus" size={13} />
						</button>
					</form>
				</div>

				{#if one.note}<p class="note">{one.note}</p>{/if}

				{#if one.notes.length}
					<div class="flavours">
						{#each one.notes as flavour (flavour.id)}
							<span class="flavour" style:--ink="var(--{flavour.series})">{flavour.note}</span>
						{/each}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p class="none">Nobody has written anything down about this one yet.</p>
{/if}

<style>
	.tastings {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		list-style: none;
		margin: 0;
		padding: 0;
	}
	/* Each occasion in its own box rather than divided rows: a tasting is a date,
	   a person, a score and some words, and a rule between them does not say as
	   clearly as a box does that they belong to one evening. */
	li {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-6) 14px;
		border: 1px solid var(--bd);
		border-radius: var(--radius-ctl);
		background: var(--card2);
	}
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-4);
	}
	.when {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.score {
		margin-left: auto;
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.drop {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		min-height: auto;
		padding: 0;
		border: 0;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--fg3);
		opacity: 0;
	}
	/* The ✕ is the plus, turned. */
	.drop :global(svg) {
		transform: rotate(45deg);
	}
	li:hover .drop,
	.drop:focus-visible {
		opacity: 1;
	}
	.drop:hover {
		color: var(--red);
	}
	.note {
		margin: 0;
		font-size: var(--text-md);
		line-height: 1.5;
		color: var(--fg2);
	}
	.flavours {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.flavour {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--ink) 18%, transparent);
		color: color-mix(in srgb, var(--ink) 70%, var(--fg1));
		font-size: var(--text-xs);
	}
	.none {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
	}
</style>
