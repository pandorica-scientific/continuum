<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// The matched term inside a search snippet, and nothing else.
	//
	// A component rather than a span inlined at each call site: highlighting
	// inside prose had no owner, and near-identical inline copies are this
	// codebase's most common defect.
	//
	// Weight and a tint, never a border and never the row. A bordered highlight
	// reads as a pill, and pills mean state here; painting the whole row says the
	// row is in a state, which it is not — one word in it matched.
	//
	// Yellow because yellow is already the attention hue in the pill scale, so a
	// matched term and an expiring pill agree rather than competing.
	let { children }: { children: import('svelte').Snippet } = $props();
</script>

<mark>{@render children()}</mark>

<style>
	mark {
		background: var(--yellow-tint);
		/* The ink is a token, not `inherit`: on the tint the body ramp is the
		   thing that has to carry the contrast, and light theme is where that is
		   tightest. If it ever fails, darken this to --fg1 — never deepen the
		   tint, which would turn a highlight into a block of colour. */
		color: var(--fg1);
		font-weight: 600;
		border-radius: 3px;
		padding: 0 1px;
	}
</style>
