<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import BrandMark from '$lib/components/BrandMark.svelte';
	import { MODULE_KEYS, MODULES } from '$lib/modules/registry';
	import { passwordHint } from '$lib/password-policy';

	import { currencyLabel } from '$lib/currencies';
	import Field from '$lib/components/Field.svelte';

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
		<Field label="Household name">
			<input
				name="householdName"
				placeholder="e.g. Robert & Tereza"
				value={entered?.householdName ?? ''}
			/>
		</Field>

		<Field label="Base currency — totals convert to this; balances keep their own currency">
			<select name="baseCurrency">
				{#each data.currencies as c (c)}
					<option value={c} selected={c === selectedCurrency}>{currencyLabel(c)}</option>
				{/each}
			</select>
		</Field>

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
						autocomplete="new-password"
						placeholder={`Password (${passwordHint(data.passwordMinLength)})`}
					/>
					<!-- The only password on a fresh instance, so it is asked twice. A
					     typo here used to lock the owner out with nothing to fall back on. -->
					<input
						name="personPasswordConfirm"
						type="password"
						autocomplete="new-password"
						placeholder="Repeat password"
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
		/* Four fields per person — name, birth year, password, repeat — need more
		   than the 560px this used to be, where the fourth wrapped onto its own
		   row and read as a field belonging to nobody. */
		max-width: 640px;
		margin: 0 auto;
		padding: 48px 20px 80px;
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.wordmark {
		font-size: var(--text-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	h1 {
		margin: 10px 0 0;
		font-size: var(--text-4xl);
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.lead {
		margin: 0;
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding: 18px;
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
		grid-template-columns: minmax(0, 1.2fr) 84px minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-4);
	}
	.toggle {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		font-size: var(--text-md);
		color: var(--fg2);
	}
	.note {
		color: var(--fg3);
	}
	/* Below the width where four boxes stay usable, the row becomes two lines —
	   who they are, then the password twice — rather than four stacked boxes
	   that lose which pair belongs together. Two declared columns and four
	   children auto-flow into exactly that shape. */
	@media (max-width: 640px) {
		.person-row {
			grid-template-columns: minmax(0, 1fr) 84px;
		}
	}

	@media (max-width: 380px) {
		.person-row {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
