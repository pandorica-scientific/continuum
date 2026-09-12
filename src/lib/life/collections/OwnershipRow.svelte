<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	/**
	 * The three controls that change what the cellar holds.
	 *
	 * Each posts the direction it means and the server applies the rule from
	 * `ownership.ts`. Nothing here does arithmetic: a browser that computed the
	 * new pair and posted it would be a second implementation of the rules, and
	 * two implementations of `opened <= owned` is how the CHECK starts failing.
	 */
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { stateOf } from '$lib/life/collections/ownership';

	let { owned, opened }: { owned: number; opened: number } = $props();

	const state = $derived(stateOf({ owned, opened }));
</script>

<div class="ownership">
	<span class="what">Bottles owned</span>

	<form method="POST" action="?/count" use:enhance>
		<!-- The count sits between its own two controls, so "− 4 +" reads as one
		     number being changed rather than as two buttons beside a figure. -->
		<div class="stepper">
			<button
				class="step"
				type="submit"
				name="move"
				value="remove"
				disabled={owned <= 0}
				aria-label="One fewer bottle"
			>
				<Icon name="plus" size={14} />
			</button>
			<span class="count mono">{owned}</span>
			<button class="step plus" type="submit" name="move" value="add" aria-label="One more bottle">
				<Icon name="plus" size={14} />
			</button>
		</div>

		<span class="state {state.kind}">{state.label}</span>

		<button
			class="btn"
			type="submit"
			name="move"
			value="open"
			disabled={opened >= owned}
			title={opened >= owned ? 'Nothing sealed left to open' : undefined}
		>
			Open one
		</button>
	</form>
</div>

<style>
	.ownership {
		display: flex;
		align-items: center;
		gap: var(--space-6);
		flex-wrap: wrap;
	}
	.what {
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.stepper {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--bd2);
		border-radius: var(--radius-ctl);
		background: var(--card2);
	}
	.step {
		width: 26px;
		height: 26px;
		min-height: auto;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: var(--radius-pill);
		background: none;
		color: var(--fg2);
	}
	.step:hover:not(:disabled) {
		background: var(--surface-3);
		color: var(--rose);
	}
	.step:disabled {
		opacity: 0.4;
	}
	.count {
		min-width: 20px;
		text-align: center;
		font-size: var(--text-lg);
		color: var(--fg1);
	}
	.state {
		padding: var(--space-3) var(--space-5);
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		color: var(--fg2);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.state.open,
	.state.some-open {
		background: var(--rose-tint);
		color: var(--rose);
	}
	.state.finished {
		color: var(--fg3);
	}
	/* Shown, never clamped: a clamp hides the bug it is covering. */
	.state.impossible {
		background: var(--red-tint);
		color: var(--red);
	}
	form {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex-wrap: wrap;
	}
	/* The minus is the plus with one stroke hidden, so the set needs no second
	   glyph for it. */
	.step:not(.plus) :global(svg line:first-child) {
		display: none;
	}
</style>
