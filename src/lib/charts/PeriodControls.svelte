<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The window lives in the URL, so the back button steps back through windows
	// and a link to March still means March tomorrow.
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

	// keepFocus keeps the keyboard while stepping through months; noScroll stops
	// a panel half-way down the Overview jumping back to the top on every step.
	const show = (next: Period, month: string | null) =>
		goto(periodQuery(next, month), { keepFocus: true, noScroll: true });

	// aria-disabled rather than the native `disabled`: a disabled button drops
	// out of the tab order immediately, losing focus to <body> mid-keyboard-walk.
	const step = (month: string | null) => {
		if (month) show(period, month);
	};

	const earlier = $derived(
		anchor && bounds && anchor > bounds.earliest ? addMonths(anchor, -1) : null
	);
	const later = $derived(anchor && bounds && anchor < bounds.latest ? addMonths(anchor, 1) : null);
</script>

<div class="row">
	<Segmented options={OPTIONS} value={period} onchange={(next) => show(next as Period, anchor)} />

	<!-- Steppers only for a single month; other windows change via the segmented control. -->
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
	/* Not dimmed with opacity (contrast failure); aria-disabled keeps it focusable. */
	.step[aria-disabled='true'] {
		color: var(--fg3);
		cursor: default;
	}
</style>
