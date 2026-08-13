<script lang="ts">
	import BrandMark from '$lib/components/BrandMark.svelte';
	import { MODULE_KEYS } from '$lib/modules/registry';

	let { form } = $props();

	const moduleLabels: Record<string, string> = {
		import: 'Import — statements, cash flow and accounts',
		property: 'Property',
		investments: 'Investments',
		loans: 'Loans',
		retirement: 'Retirement',
		home: 'Home Assistant',
		calendar: 'Calendar',
		documents: 'Documents'
	};

	let peopleCount = $state(2);
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
			<input name="householdName" placeholder="e.g. Robert & Tereza" />
		</label>

		<label class="field">
			<span>Base currency — totals convert to this; balances keep their own currency</span>
			<select name="baseCurrency">
				<option value="CZK">CZK — Czech koruna</option>
				<option value="EUR">EUR — Euro</option>
				<option value="PLN">PLN — Polish złoty</option>
			</select>
		</label>

		<fieldset>
			<legend class="eyebrow">People</legend>
			{#each { length: peopleCount }, i (i)}
				<div class="person-row">
					<input name="personName" placeholder="Name" required={i === 0} />
					<input name="personBirthYear" placeholder="Birth year" inputmode="numeric" />
					<input name="personPassword" type="password" placeholder="Password (8+ characters)" />
				</div>
			{/each}
			<button type="button" class="btn" onclick={() => (peopleCount += 1)}>➕ Add a person</button>
		</fieldset>

		<fieldset>
			<legend class="eyebrow">Modules — switch off what you do not have</legend>
			{#each MODULE_KEYS as key (key)}
				<label class="toggle">
					<input type="checkbox" name={`module_${key}`} checked />
					<span>{moduleLabels[key]}</span>
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
	@media (max-width: 560px) {
		.person-row {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
