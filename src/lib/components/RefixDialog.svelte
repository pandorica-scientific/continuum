<script lang="ts">
	import { enhance } from '$app/forms';
	import { messageFromActionResult, shouldCloseAfterAction } from '$lib/actions/result';
	import ActionError from '$lib/components/ActionError.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import LoanScenarioPreview from '$lib/components/LoanScenarioPreview.svelte';
	import { applyFixation, project } from '$lib/loans/simulate';
	import {
		decodeScenarioPayload,
		defaultFixationStart,
		type ScenarioPayload
	} from '$lib/loans/scenario';
	import { parseAmountToMinor } from '$lib/money';
	let {
		loanId,
		currency,
		sim,
		onclose
	}: { loanId: string; currency: string; sim: ScenarioPayload; onclose: () => void } = $props();

	// The parent keys this draft by loan. This is intentionally the boundary of
	// the period in force today, never a maximum historical end date.
	// svelte-ignore state_referenced_locally
	let startDate = $state(defaultFixationStart(sim.periods, new Date().toISOString().slice(0, 10)));
	let rate = $state('');
	let payment = $state('');
	let endDate = $state('');
	let actionError = $state<string | null>(null);

	const scenario = $derived(decodeScenarioPayload(sim));
	const base = $derived(project(scenario.terms, scenario.periods));

	const whatIf = $derived.by(() => {
		try {
			if (!startDate || !rate.trim() || !payment.trim()) return null;
			const annualRatePct = Number(rate.replace(',', '.'));
			if (!Number.isFinite(annualRatePct) || annualRatePct < 0 || annualRatePct > 100) return null;
			const paymentMinor = parseAmountToMinor(payment, currency);
			if (paymentMinor <= 0n) return null;
			const next = applyFixation(scenario.periods, {
				startDate,
				endDate: endDate || null,
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

		<LoanScenarioPreview
			{base}
			alternative={whatIf}
			{currency}
			alternativeTitle="With this fixation"
			emptyText="fill in rate and payment to preview the offer"
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
