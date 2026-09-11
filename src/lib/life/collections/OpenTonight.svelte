<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * At most two bottles worth opening, each saying why.
	 *
	 * The reason is derived, never written: a household can disagree with the
	 * reasoning rather than with the taste. A cellar with nothing to suggest
	 * draws no card at all — a suggestion box with nothing to suggest is worse
	 * than no box.
	 */
	import Icon from '$lib/components/Icon.svelte';
	import type { Suggestion } from '$lib/life/collections/open-tonight';

	let { suggestions }: { suggestions: Suggestion[] } = $props();
</script>

{#if suggestions.length}
	<section class="tonight">
		<h2><Icon name="sparkle" size={14} /> Open tonight</h2>
		<ul>
			{#each suggestions as suggestion (suggestion.id)}
				<li>
					<a href="/collections/bottles/{suggestion.id}">
						{#if suggestion.producer}<span class="producer">{suggestion.producer}</span>{/if}
						<span class="name">{suggestion.name}</span>
					</a>
					<span class="because">{suggestion.because}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.tonight {
		padding: 18px 20px;
		border: 1px solid color-mix(in srgb, var(--rose) 30%, transparent);
		border-radius: var(--radius-card);
		background: var(--rose-wash);
	}
	h2 {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0 0 var(--space-5);
		font-size: var(--text-xs);
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--rose);
	}
	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5) var(--space-8, 20px);
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	a {
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.producer {
		color: var(--fg2);
	}
	.producer::after {
		content: ' ';
	}
	.name {
		font-weight: 600;
	}
	.because {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
</style>
