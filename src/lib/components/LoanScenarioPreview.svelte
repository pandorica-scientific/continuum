<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import LoanSchedule from '$lib/charts/LoanSchedule.svelte';
	import type { YearAgg } from '$lib/loans/simulate';
	import { comparisonBars } from '$lib/loans/scenario';
	import { formatMinor } from '$lib/money';

	type Projection = {
		years: YearAgg[];
		summary: { debtFreeMonth: string | null; totalInterestMinor: bigint };
	};

	let {
		base,
		alternative,
		currency,
		alternativeTitle,
		emptyText,
		showCost = false
	}: {
		base: Projection;
		alternative: Projection | null;
		currency: string;
		alternativeTitle: string;
		emptyText: string;
		showCost?: boolean;
	} = $props();

	const shown = $derived(alternative ?? base);
	const difference = $derived(
		alternative ? base.summary.totalInterestMinor - alternative.summary.totalInterestMinor : null
	);
</script>

<div class="preview">
	<div class="p-head">
		<span class="p-title">{alternative ? alternativeTitle : 'Current schedule'}</span>
		<span class="p-note">
			{#if alternative}
				debt-free {base.summary.debtFreeMonth ?? '—'} →
				<b>{alternative.summary.debtFreeMonth ?? '—'}</b>
				· interest {formatMinor(base.summary.totalInterestMinor, currency)} →
				<b>{formatMinor(alternative.summary.totalInterestMinor, currency)}</b>
				{#if difference !== null && difference > 0n}
					· <span class="saves">saves {formatMinor(difference, currency)} {currency}</span>
				{:else if showCost && difference !== null && difference < 0n}
					· <span class="costs">costs {formatMinor(-difference, currency)} {currency} more</span>
				{/if}
			{:else}
				{emptyText}
			{/if}
		</span>
	</div>
	<LoanSchedule years={comparisonBars(shown.years, currency)} {currency} />
</div>

<style>
	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		background: var(--card2);
		border: 1px solid var(--bd);
		border-radius: var(--radius-lg);
		padding: 13px 15px;
	}
	.p-head {
		display: flex;
		align-items: baseline;
		gap: var(--space-6);
		flex-wrap: wrap;
	}
	.p-title {
		font-size: var(--text-md);
		font-weight: 500;
	}
	.p-note {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.p-note b {
		color: var(--fg1);
		font-weight: 600;
	}
	.saves {
		color: var(--green);
		font-weight: 600;
	}
	.costs {
		color: var(--red);
		font-weight: 600;
	}
</style>
