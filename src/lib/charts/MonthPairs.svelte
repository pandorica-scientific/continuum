<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { formatMinor, fromMajor } from '$lib/money';
	import { monthLabel } from '$lib/cashflow/period';

	/**
	 * Six months, two bars each: what came in beside what went out.
	 * Boxes rather than SVG — nothing here needs a coordinate system.
	 */
	interface Month {
		/** `YYYY-MM`. */
		month: string;
		earned: number;
		spent: number;
	}

	let {
		months,
		currency,
		current = null
	}: {
		months: Month[];
		currency: string;
		/** The month the screen is anchored on; its label is set heavier. */
		current?: string | null;
	} = $props();

	const max = $derived(Math.max(1, ...months.flatMap((m) => [m.earned, m.spent])));
	// Any movement gets a visible bar: 0% reads as missing data.
	const pct = (value: number) => (value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0);
	const fmt = (value: number) => formatMinor(fromMajor(value, currency), currency);
	const short = (month: string) => monthLabel(month).slice(0, 3);
	const summary = $derived(
		months.map((m) => `${monthLabel(m.month)}: in ${fmt(m.earned)}, out ${fmt(m.spent)}`).join('; ')
	);
</script>

<div class="pairs" role="img" aria-label="Money in and out by month. {summary}">
	{#each months as m (m.month)}
		<div class="month" class:current={m.month === current}>
			<div class="bars">
				<span class="bar in" style:height="{pct(m.earned)}%" title="In · {fmt(m.earned)}"></span>
				<span class="bar out" style:height="{pct(m.spent)}%" title="Out · {fmt(m.spent)}"></span>
			</div>
			<span class="label">{short(m.month)}</span>
		</div>
	{/each}
</div>

<style>
	.pairs {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
		gap: var(--space-4);
		min-width: 0;
	}
	.month {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
	}
	.bars {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: var(--space-2);
		width: 100%;
		height: 140px;
	}
	/* 38% of the column, capped at 34px, so phone and monitor draw the same picture. */
	.bar {
		display: block;
		width: 38%;
		max-width: 34px;
		border-radius: 6px 6px 3px 3px;
		transition:
			height var(--dur-slow) var(--ease),
			filter var(--dur) var(--ease);
	}
	.bar:hover {
		filter: brightness(1.15);
	}
	.in {
		background: linear-gradient(
			to bottom,
			var(--green),
			color-mix(in srgb, var(--green) 55%, transparent)
		);
	}
	.out {
		background: linear-gradient(
			to bottom,
			var(--red),
			color-mix(in srgb, var(--red) 55%, transparent)
		);
	}
	.label {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.current .label {
		font-weight: 600;
		color: var(--fg1);
	}
</style>
