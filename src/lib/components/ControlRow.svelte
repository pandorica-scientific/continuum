<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import type { Snippet } from 'svelte';

	let { left, right }: { left?: Snippet; right?: Snippet } = $props();
</script>

<!-- Search and a screen's actions, one row, control height — so the field, the
     link and the button line up without any of them being told about the
     others. One primary action on the right; never two. -->
<div class="row">
	<div class="left">{@render left?.()}</div>
	<div class="right">{@render right?.()}</div>
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-height: var(--control-h);
		flex-wrap: wrap;
	}
	.left {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		flex: 1 1 280px;
		min-width: 0;
	}
	.right {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin-left: auto;
	}
</style>
