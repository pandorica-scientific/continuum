<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import LoanSchedule from '$lib/charts/LoanSchedule.svelte';
	import type { DayCount } from '$lib/loans';
	import { applyFixation, project, type YearAgg } from '$lib/loans/simulate';
	import { formatMinor, parseAmountToMinor } from '$lib/money';

	interface SimPayload {
		terms: {
			owedMinor: string;
			owedAsOfMonth: string;
			dayCount: string;
			accrualStyle: string;
			paymentDay: number;
		};
		periods: {
			startDate: string;
			endDate: string | null;
			annualRatePct: number;
			paymentMinor: string;
		}[];
	}
	let {
		loanId,
		currency,
		sim,
		onclose
	}: { loanId: string; currency: string; sim: SimPayload; onclose: () => void } = $props();

	// sensible default: the day the current fixation ends, else today
	const lastEnd = sim.periods.reduce<string | null>(
		(max, p) => (p.endDate && (!max || p.endDate > max) ? p.endDate : max),
		null
	);
	let startDate = $state(lastEnd ?? new Date().toISOString().slice(0, 10));
	let rate = $state('');
	let payment = $state('');
	let endDate = $state('');

	const terms = $derived({
		owedMinor: BigInt(sim.terms.owedMinor),
		owedAsOfMonth: sim.terms.owedAsOfMonth,
		dayCount: sim.terms.dayCount as DayCount,
		accrualStyle: sim.terms.accrualStyle as 'payment' | 'calendar',
		paymentDay: sim.terms.paymentDay
	});
	const periods = $derived(
		sim.periods.map((p) => ({ ...p, paymentMinor: BigInt(p.paymentMinor) }))
	);
	const base = $derived(project(terms, periods));

	const whatIf = $derived.by(() => {
		try {
			if (!startDate || !rate.trim() || !payment.trim()) return null;
			const annualRatePct = Number(rate.replace(',', '.'));
			if (!Number.isFinite(annualRatePct) || annualRatePct < 0 || annualRatePct > 100) return null;
			const paymentMinor = parseAmountToMinor(payment, currency);
			if (paymentMinor <= 0n) return null;
			const next = applyFixation(periods, {
				startDate,
				endDate: endDate || null,
				annualRatePct,
				paymentMinor
			});
			return project(terms, next);
		} catch {
			return null;
		}
	});

	const bars = (years: YearAgg[]) =>
		years.map((y) => ({
			year: y.year,
			interest: Number(y.interestMinor),
			principal: Number(y.principalMinor),
			interestLabel: formatMinor(y.interestMinor, currency),
			principalLabel: formatMinor(y.principalMinor, currency)
		}));
	const shown = $derived(whatIf ?? base);
	const savings = $derived(
		whatIf ? base.summary.totalInterestMinor - whatIf.summary.totalInterestMinor : null
	);
</script>

<Modal title="🔁 New fixation — try the offer before saving it" {onclose}>
	<form
		method="POST"
		action="?/addFixation"
		use:enhance={() =>
			async ({ update, result }) => {
				await update();
				if (result.type === 'success') onclose();
			}}
		class="body"
	>
		<input type="hidden" name="loanId" value={loanId} />
		<div class="fields">
			<label><span>From</span><input name="startDate" type="date" bind:value={startDate} /></label>
			<label
				><span>Annual rate %</span><input
					name="rate"
					inputmode="decimal"
					placeholder="3.89"
					bind:value={rate}
				/></label
			>
			<label
				><span>New monthly payment</span><input
					name="payment"
					inputmode="decimal"
					placeholder="52 300"
					bind:value={payment}
				/></label
			>
			<label
				><span>Fixed until (blank = open-ended)</span><input
					name="endDate"
					type="date"
					bind:value={endDate}
				/></label
			>
		</div>

		<div class="preview">
			<div class="p-head">
				<span class="p-title">{whatIf ? 'With this fixation' : 'Current schedule'}</span>
				<span class="p-note">
					{#if whatIf}
						debt-free {base.summary.debtFreeMonth ?? '—'} →
						<b>{whatIf.summary.debtFreeMonth ?? '—'}</b>
						· interest {formatMinor(base.summary.totalInterestMinor, currency)} →
						<b>{formatMinor(whatIf.summary.totalInterestMinor, currency)}</b>
						{#if savings !== null && savings > 0n}
							· <span class="saves">saves {formatMinor(savings, currency)} {currency}</span>
						{:else if savings !== null && savings < 0n}
							· <span class="costs">costs {formatMinor(-savings, currency)} {currency} more</span>
						{/if}
					{:else}
						fill in rate and payment to preview the offer
					{/if}
				</span>
			</div>
			<LoanSchedule years={bars(shown.years)} {currency} />
		</div>

		<div class="row">
			<button type="submit" class="btn btn-primary" disabled={!whatIf}>Add fixation</button>
			<button type="button" class="btn" onclick={onclose}>Cancel</button>
			<span class="hint">The current period closes at the new start — history stays.</span>
		</div>
	</form>
</Modal>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		color: var(--fg3);
	}
	input {
		border: 1px solid var(--bd2);
		background: var(--card2);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
	}
	.preview {
		display: flex;
		flex-direction: column;
		gap: 10px;
		background: var(--card2);
		border: 1px solid var(--bd);
		border-radius: 10px;
		padding: 13px 15px;
	}
	.p-head {
		display: flex;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
	}
	.p-title {
		font-size: 13px;
		font-weight: 500;
	}
	.p-note {
		font-size: 12px;
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
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.hint {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
