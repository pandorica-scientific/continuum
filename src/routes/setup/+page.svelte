<script lang="ts">
	import BrandMark from '$lib/components/BrandMark.svelte';
	import { MODULE_KEYS, MODULES } from '$lib/modules/registry';
	import { passwordHint } from '$lib/password-policy';

	import { currencyLabel } from '$lib/currencies';

	let { data, form } = $props();

	// What survived a rejected submission. Passwords are never sent back, so those
	// boxes start empty and have to be retyped — everything else is restored.
	const entered = $derived(form?.entered);
	const enteredPeople = $derived(entered?.people ?? []);
	const selectedCurrency = $derived(
		entered && data.currencies.includes(entered.baseCurrency)
			? entered.baseCurrency
			: data.currencies[0]
	);

	// Rows the wizard shows: what came back, never fewer than two, plus any the
	// person added by hand.
	let extraRows = $state(0);
	const peopleCount = $derived(Math.max(enteredPeople.length, 2) + extraRows);
</script>

<svelte:head><title>Set up Continuum</title></svelte:head>

<div class="wrap">
	<div class="brand">
		<BrandMark size={26} />
		<span class="wordmark">Continuum</span>
	</div>
	<h1>Set up your household ledger</h1>
	<p class="lead">
		Everything here — people, currency, modules — is yours to change later in Settings. Nothing is
		hard-coded.
	</p>

	{#if form?.message}
		<div class="error">{form.message}</div>
	{/if}

	<form method="POST" class="card form">
		<label class="field">
			<span>Household name</span>
			<input
				name="householdName"
				placeholder="e.g. Robert & Tereza"
				value={entered?.householdName ?? ''}
			/>
		</label>

		<label class="field">
			<span>Base currency — totals convert to this; balances keep their own currency</span>
			<select name="baseCurrency">
				{#each data.currencies as c (c)}
					<option value={c} selected={c === selectedCurrency}>{currencyLabel(c)}</option>
				{/each}
			</select>
		</label>

		<fieldset>
			<legend class="eyebrow">People</legend>
			{#each { length: peopleCount }, i (i)}
				<div class="person-row">
					<input
						name="personName"
						placeholder="Name"
						required={i === 0}
						value={enteredPeople[i]?.name ?? ''}
					/>
					<input
						name="personBirthYear"
						placeholder="Birth year"
						inputmode="numeric"
						value={enteredPeople[i]?.birthYear ?? ''}
					/>
					<input
						name="personPassword"
						type="password"
						placeholder={`Password (${passwordHint(data.passwordMinLength)})`}
					/>
				</div>
			{/each}
			<button type="button" class="btn" onclick={() => (extraRows += 1)}>➕ Add a person</button>
		</fieldset>

		<fieldset>
			<legend class="eyebrow">Modules — switch off what you do not have</legend>
			{#each MODULE_KEYS as key (key)}
				{@const m = MODULES[key]}
				<label class="toggle">
					<input type="checkbox" name={`module_${key}`} checked={entered?.modules[key] ?? true} />
					<span>{m.emoji} {m.label} <span class="note">— {m.note}</span></span>
				</label>
			{/each}
		</fieldset>

		<button type="submit" class="btn btn-primary">Create household</button>
	</form>
</div>

<style>
	.wrap {
		max-width: 560px;
		margin: 0 auto;
		padding: 48px 20px 80px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.wordmark {
		font-size: 15.5px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	h1 {
		margin: 10px 0 0;
		font-size: 28px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.lead {
		margin: 0;
		font-size: 13.6px;
		color: var(--fg3);
	}
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding: 18px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12.5px;
		color: var(--fg3);
	}
	input,
	select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13.5px;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
	legend {
		padding: 0 0 4px;
	}
	.person-row {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) 90px minmax(0, 1fr);
		gap: 8px;
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13.5px;
		color: var(--fg2);
	}
	.note {
		color: var(--fg3);
	}
	@media (max-width: 560px) {
		.person-row {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
