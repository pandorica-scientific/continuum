<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The colour comes from `deltaTone`, not the sign: spending 12% more is the
	// same arrow as earning 12% more and the opposite piece of news.
	import { deltaPct, deltaTone } from './delta';

	let {
		current,
		previous,
		goodWhenUp,
		against
	}: {
		current: number;
		previous: number;
		/** Whether a rise is the good news here. Spending says no; earning says yes. */
		goodWhenUp: boolean;
		against: string;
	} = $props();

	const pct = $derived(deltaPct(current, previous));
	const tone = $derived(deltaTone(pct, goodWhenUp));
	const arrow = $derived(pct === null || pct === 0 ? '' : pct > 0 ? '▲' : '▼');
	const text = $derived(pct === null ? '—' : `${arrow}${arrow ? ' ' : ''}${Math.abs(pct)}%`);
	const label = $derived(
		pct === null
			? 'no comparison'
			: pct === 0
				? `unchanged on ${against}`
				: `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% on ${against}`
	);
</script>

<!-- role="img": announce the label, not the raw arrow glyph plus a bare number. -->
<span class="mono delta" role="img" aria-label={label} style:color="var({tone})">{text}</span>

<style>
	.delta {
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
