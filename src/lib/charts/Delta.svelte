<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// What a figure did against the window before it, in the six characters there
	// is room for beside it.
	//
	// The arrow carries the sign so the number can be a magnitude: a minus sign
	// in a column of percentages is a character wide and easy to miss, and "down"
	// is the thing the reader is actually looking for. The colour is the same
	// judgement in a second channel, which is why it comes from `deltaTone` and
	// not from the sign — spending 12% more is the same arrow as earning 12% more
	// and the opposite piece of news.
	import { deltaPct, deltaTone } from './delta';

	let {
		current,
		previous,
		goodWhenUp,
		against
	}: {
		current: number;
		/** The same figure, one window earlier. */
		previous: number;
		/** Whether a rise is the good news here. Spending says no; earning says yes. */
		goodWhenUp: boolean;
		/** The window being compared against, as the caption on screen names it. */
		against: string;
	} = $props();

	const pct = $derived(deltaPct(current, previous));
	const tone = $derived(deltaTone(pct, goodWhenUp));
	// An arrow on a window that did not move would be a direction where there is
	// none, so an unchanged figure is a bare 0%.
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

<!--
	role="img" so the name below is the whole of what is announced. An arrow
	glyph read out as an arrow glyph, followed by a number with no year attached
	to it, is noise; "up 12% on July 2025" is the sentence the figure means.
-->
<span class="mono delta" role="img" aria-label={label} style:color="var({tone})">{text}</span>

<style>
	.delta {
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
