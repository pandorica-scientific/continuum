<script lang="ts">
	import { enhance } from '$app/forms';
	import { messageFromActionResult, shouldCloseAfterAction } from '$lib/actions/result';
	import ActionError from '$lib/components/ActionError.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import LoanScenarioPreview from '$lib/components/LoanScenarioPreview.svelte';
	import { applyRepayment, project } from '$lib/loans/simulate';
	import { decodeScenarioPayload, type ScenarioPayload } from '$lib/loans/scenario';
	import { parseAmountToMinor } from '$lib/money';
	let {
		loanId,
		currency,
		sim,
		onclose
	}: { loanId: string; currency: string; sim: ScenarioPayload; onclose: () => void } = $props();

	let date = $state(new Date().toISOString().slice(0, 10));
	let amount = $state('');
	let balanceAfter = $state('');
	let note = $state('');
	let actionError = $state<string | null>(null);

	const scenario = $derived(decodeScenarioPayload(sim));
	const base = $derived(project(scenario.terms, scenario.periods));

	const whatIf = $derived.by(() => {
		try {
			if (!amount.trim() || !date) return null;
			const amountMinor = parseAmountToMinor(amount, currency);
			if (amountMinor <= 0n) return null;
			const balanceAfterMinor = balanceAfter.trim()
				? parseAmountToMinor(balanceAfter, currency)
				: null;
			return project(
				applyRepayment(scenario.terms, { date, amountMinor, balanceAfterMinor }),
				scenario.periods
			);
		} catch {
			return null;
		}
	});
</script>

<Modal title="💸 Record a repayment" {onclose}>
	<form
		method="POST"
		action="?/addRepayment"
		use:enhance={() =>
			async ({ update, result }) => {
				actionError = messageFromActionResult(result);
				await update();
				if (shouldCloseAfterAction(result.type)) onclose();
			}}
		class="body"
	>
		<input type="hidden" name="loanId" value={loanId} />
		<ActionError message={actionError} />
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

		<LoanScenarioPreview
			{base}
			alternative={whatIf}
			{currency}
			alternativeTitle="With this repayment"
			emptyText="fill in the amount to preview the effect"
		/>

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
	/* Labels are grid items of equal height, so a caption that wraps to two
	   lines pushed its own input down and out of line with its neighbours.
	   Anchoring the control to the bottom lets the text grow upwards instead. */
	label {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 5px;
		font-size: 12px;
		color: var(--fg3);
	}
	label > input {
		margin-top: auto;
	}
	input {
		border: 1px solid var(--bd2);
		background: var(--card2);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
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
