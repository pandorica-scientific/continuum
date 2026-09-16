<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// Weight and a tint, never a border or the whole row — a border reads as a
	// pill (which means state here), and the row itself isn't in a state.
	let { children }: { children: import('svelte').Snippet } = $props();
</script>

<mark>{@render children()}</mark>

<style>
	mark {
		background: var(--yellow-tint);
		/* If contrast ever fails, darken this — never deepen the tint, which
		   would turn a highlight into a block of colour. */
		color: var(--fg1);
		font-weight: 600;
		border-radius: 3px;
		padding: 0 1px;
	}
</style>
