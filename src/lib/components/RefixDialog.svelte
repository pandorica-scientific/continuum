<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { enhance } from '$app/forms';
	import { messageFromActionResult, shouldCloseAfterAction } from '$lib/actions/result';
	import ActionError from '$lib/components/ActionError.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import LoanScenarioPreview from '$lib/components/LoanScenarioPreview.svelte';
	import { applyFixation, project } from '$lib/loans/simulate';
	import { paymentForRate, rateForPayment } from '$lib/loans/derive';
	import {
		decodeScenarioPayload,
		defaultFixationStart,
		type ScenarioPayload
	} from '$lib/loans/scenario';
	import { formatMinor, parseAmountToMinor } from '$lib/money';
	let {
		loanId,
		currency,
		sim,
		onclose
	}: { loanId: string; currency: string; sim: ScenarioPayload; onclose: () => void } = $props();

	// The parent keys this draft by loan. This is intentionally the boundary of
	// the period in force today, never a maximum historical end date.
	// svelte-ignore state_referenced_locally
	let startsOn = $state(defaultFixationStart(sim.periods, new Date().toISOString().slice(0, 10)));
	let rate = $state('');
	let payment = $state('');
	let endsOn = $state('');
	let actionError = $state<string | null>(null);

	const scenario = $derived(decodeScenarioPayload(sim));
	const base = $derived(project(scenario.terms, scenario.periods));
	/** The month the loan clears on its present terms — the term a derived
	 *  figure holds to, so an offer is compared like for like. */
	const term = $derived(base.summary.debtFreeMonth);

	// Whichever field was filled in for you. Kept so a derived value can be
	// replaced when its counterpart changes, while anything typed is never
	// overwritten — correcting a quoted payment must not move the rate.
	let derivedField = $state<'rate' | 'payment' | null>(null);

	function fillPaymentFromRate() {
		if (derivedField === 'rate') return;
		const annualRatePct = Number(rate.replace(',', '.'));
		if (!rate.trim() || !Number.isFinite(annualRatePct) || annualRatePct < 0) return;
		const derived = paymentForRate(scenario.terms, scenario.periods, startsOn, annualRatePct, term);
		if (derived === null) return;
		payment = formatMinor(derived, currency);
		derivedField = 'payment';
	}

	function fillRateFromPayment() {
		if (derivedField === 'payment') return;
		if (!payment.trim()) return;
		let paymentMinor: bigint;
		try {
			paymentMinor = parseAmountToMinor(payment, currency);
		} catch {
			return;
		}
		const derived = rateForPayment(scenario.terms, scenario.periods, startsOn, paymentMinor, term);
		if (derived === null) return;
		rate = String(derived);
		derivedField = 'rate';
	}

	const whatIf = $derived.by(() => {
		try {
			if (!startsOn || !rate.trim() || !payment.trim()) return null;
			const annualRatePct = Number(rate.replace(',', '.'));
			if (!Number.isFinite(annualRatePct) || annualRatePct < 0 || annualRatePct > 100) return null;
			const paymentMinor = parseAmountToMinor(payment, currency);
			if (paymentMinor <= 0n) return null;
			const next = applyFixation(scenario.periods, {
				startsOn,
				endsOn: endsOn || null,
				annualRatePct,
				paymentMinor
			});
			return project(scenario.terms, next);
		} catch {
			return null;
		}
	});
</script>

<Modal title="🔁 New fixation — try the offer before saving it" {onclose}>
	<form
		method="POST"
		action="?/addFixation"
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
			<label><span>From</span><input name="startsOn" type="date" bind:value={startsOn} /></label>
			<label
				><span>Annual rate %{derivedField === 'rate' ? ' · derived' : ''}</span><input
					name="rate"
					oninput={() => {
						if (derivedField === 'rate') derivedField = null;
					}}
					onchange={fillPaymentFromRate}
					onblur={fillPaymentFromRate}
					inputmode="decimal"
					placeholder="3.89"
					bind:value={rate}
				/></label
			>
			<label
				><span>New monthly payment{derivedField === 'payment' ? ' · derived' : ''}</span><input
					name="payment"
					oninput={() => {
						if (derivedField === 'payment') derivedField = null;
					}}
					onchange={fillRateFromPayment}
					onblur={fillRateFromPayment}
					inputmode="decimal"
					placeholder="52 300"
					bind:value={payment}
				/></label
			>
			<label
				><span>Fixed until (blank = open-ended)</span><input
					name="endsOn"
					type="date"
					bind:value={endsOn}
				/></label
			>
		</div>

		<LoanScenarioPreview
			{base}
			alternative={whatIf}
			{currency}
			alternativeTitle="With this fixation"
			emptyText="name a rate or a payment — the other is worked out to hold the same term"
			showCost={true}
		/>

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
	/* Labels are grid items of equal height, so a caption that wraps to two
	   lines pushed its own input down and out of line with its neighbours.
	   Anchoring the control to the bottom lets the text grow upwards instead. */
	label {
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		gap: 5px;
		font-size: var(--text-sm);
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
		font-size: var(--text-md);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
