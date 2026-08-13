<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import LoanSchedule from '$lib/charts/LoanSchedule.svelte';
	import type { DayCount } from '$lib/loans';
	import { applyRepayment, project, type YearAgg } from '$lib/loans/simulate';
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

	let date = $state(new Date().toISOString().slice(0, 10));
	let amount = $state('');
	let balanceAfter = $state('');
	let note = $state('');

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
			if (!amount.trim() || !date) return null;
			const amountMinor = parseAmountToMinor(amount, currency);
			if (amountMinor <= 0n) return null;
			const balanceAfterMinor = balanceAfter.trim()
				? parseAmountToMinor(balanceAfter, currency)
				: null;
			return project(applyRepayment(terms, { date, amountMinor, balanceAfterMinor }), periods);
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

<Modal title="💸 Record a repayment" {onclose}>
	<form
		method="POST"
		action="?/addRepayment"
		use:enhance={() =>
			async ({ update, result }) => {
				await update();
				if (result.type === 'success') onclose();
			}}
		class="body"
	>
		<input type="hidden" name="loanId" value={loanId} />
		<div class="fields">
			<label><span>Date</span><input name="date" type="date" bind:value={date} /></label>
			<label
				><span>Amount</span><input
					name="amount"
					inputmode="decimal"
					placeholder="300 000"
					bind:value={amount}
				/></label
			>
			<label
				><span>Balance after (optional, from the bank)</span><input
					name="balanceAfter"
					inputmode="decimal"
					placeholder="blank = amount comes off"
					bind:value={balanceAfter}
				/></label
			>
			<label
				><span>Note</span><input
					name="note"
					placeholder="e.g. annual free repayment"
					bind:value={note}
				/></label
			>
		</div>

		<div class="preview">
			<div class="p-head">
				<span class="p-title">{whatIf ? 'With this repayment' : 'Current schedule'}</span>
				<span class="p-note">
					{#if whatIf}
						debt-free {base.summary.debtFreeMonth ?? '—'} →
						<b>{whatIf.summary.debtFreeMonth ?? '—'}</b>
						· interest {formatMinor(base.summary.totalInterestMinor, currency)} →
						<b>{formatMinor(whatIf.summary.totalInterestMinor, currency)}</b>
						{#if savings !== null && savings > 0n}
							· <span class="saves">saves {formatMinor(savings, currency)} {currency}</span>
						{/if}
					{:else}
						fill in the amount to preview the effect
					{/if}
				</span>
			</div>
			<LoanSchedule years={bars(shown.years)} {currency} />
		</div>

		<div class="row">
			<button type="submit" class="btn btn-primary" disabled={!whatIf}>Record repayment</button>
			<button type="button" class="btn" onclick={onclose}>Cancel</button>
			<span class="hint">A full repayment (amount = owed) closes the loan.</span>
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
