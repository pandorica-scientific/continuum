<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	// The one control that says which window the cash-flow figures cover.
	//
	// The Overview panel and the Money screen show the same figures and each used
	// to carry its own copy of the switch above them, which is how they came to
	// offer different windows and to put the caption on different sides of the
	// row. One component, two screens, and the window lives in the URL — so the
	// back button steps back through windows and a link to March still means
	// March tomorrow.
	import { goto } from '$app/navigation';
	import Segmented from '$lib/components/Segmented.svelte';
	import {
		addMonths,
		monthLabel,
		periodQuery,
		type MonthSpan,
		type Period
	} from '$lib/cashflow/period';

	let {
		period,
		anchor,
		bounds,
		caption
	}: {
		period: Period;
		/** The month the window ends on, `YYYY-MM`, or null on an empty instance. */
		anchor: string | null;
		/** What the record covers, which is where the steppers stop. */
		bounds: MonthSpan | null;
		/** The window in words, as the loader named it. */
		caption: string;
	} = $props();

	const OPTIONS = [
		{ value: 'ytd', label: 'Year to date' },
		{ value: 'month', label: 'This month' },
		{ value: '12m', label: '12 months' }
	];

	// keepFocus so the arrow a person is walking through months with keeps the
	// keyboard, and noScroll so a panel half-way down the Overview does not throw
	// the page back to the top on every step.
	const show = (next: Period, month: string | null) =>
		goto(periodQuery(next, month), { keepFocus: true, noScroll: true });

	// Stepping to a month there is no record for is refused here rather than by
	// the browser. A native `disabled` takes the button out of the tab order the
	// instant it is set, so walking back to the earliest month with the keyboard
	// disabled the button under the caret and dropped focus to <body> — the one
	// place keepFocus cannot bring it back from. aria-disabled announces the same
	// thing to a screen reader while leaving the button reachable, so the arrow
	// stays where the hand left it and the other one is a Tab away.
	const step = (month: string | null) => {
		if (month) show(period, month);
	};

	// The months either arrow leads to, or null where there is no record to walk.
	const earlier = $derived(
		anchor && bounds && anchor > bounds.earliest ? addMonths(anchor, -1) : null
	);
	const later = $derived(anchor && bounds && anchor < bounds.latest ? addMonths(anchor, 1) : null);
</script>

<div class="row">
	<Segmented options={OPTIONS} value={period} onchange={(next) => show(next as Period, anchor)} />

	<!--
		Steppers only for a single month. A year-to-date or trailing-year window
		moved by one month is a window nobody asked for, and the segmented control
		is already the way to change which window it is.
	-->
	<div class="window">
		{#if period === 'month'}
			<button
				type="button"
				class="step"
				aria-disabled={earlier === null}
				aria-label={earlier ? `Show ${monthLabel(earlier)}` : 'No earlier month'}
				onclick={() => step(earlier)}>‹</button
			>
		{/if}
		<span class="caption">{caption}</span>
		{#if period === 'month'}
			<button
				type="button"
				class="step"
				aria-disabled={later === null}
				aria-label={later ? `Show ${monthLabel(later)}` : 'No later month'}
				onclick={() => step(later)}>›</button
			>
		{/if}
	</div>
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-6);
		flex-wrap: wrap;
	}
	.window {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.caption {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* The small controls in a panel header, which these sit at the same weight as. */
	.step {
		background: var(--card2);
		border: 1px solid var(--bd);
		border-radius: var(--radius-sm);
		color: var(--fg2);
		font-size: var(--text-xs);
		line-height: 1;
		padding: 4px 7px;
		cursor: pointer;
	}
	.step:hover:not([aria-disabled='true']) {
		background: var(--card3);
	}
	/* At the end of the record, not dimmed: an arrow faded with opacity is a
	   contrast failure, and the foreground ramp says "quiet" without one. The
	   attribute rather than :disabled, because the button stays focusable. */
	.step[aria-disabled='true'] {
		color: var(--fg3);
		cursor: default;
	}
</style>
