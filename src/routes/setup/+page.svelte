<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import BrandMark from '$lib/components/BrandMark.svelte';
	import { modules } from '$lib/modules/registry';
	import { untrack } from 'svelte';
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
	// Read once, not reactive: re-deriving would fight a change made since the re-render.
	let openMode = $state(untrack(() => Boolean(entered?.openMode)));
	const peopleCount = $derived(Math.max(enteredPeople.length, 2) + extraRows);

	// Controlled (bind:value), not just printed from `entered`: an uncontrolled
	// value={...} gets reapplied whenever any sibling in the row re-renders (e.g.
	// toggling openMode below), wiping out whatever was typed since.
	const initialRowCount = untrack(() => Math.max(enteredPeople.length, 2));
	let peopleNames = $state(
		untrack(() => Array.from({ length: initialRowCount }, (_, i) => enteredPeople[i]?.name ?? ''))
	);
	let peopleBirthYears = $state(
		untrack(() =>
			Array.from({ length: initialRowCount }, (_, i) => enteredPeople[i]?.birthYear ?? '')
		)
	);
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

	<!-- Worked out from the machine, not configured. -->
	<div class="card addresses">
		<p class="addresses-title">Reach it from any device in the house at</p>
		<ul>
			{#each data.addresses as a (a.url)}
				<li><code>{a.url}</code><span class="note">{a.note}</span></li>
			{/each}
		</ul>
	</div>

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
						bind:value={peopleNames[i]}
					/>
					<input
						name="personBirthYear"
						placeholder="Birth year"
						inputmode="numeric"
						bind:value={peopleBirthYears[i]}
					/>
					<input
						name="personPassword"
						type="password"
						autocomplete="new-password"
						disabled={openMode}
						placeholder={openMode
							? 'No password'
							: `Password (${passwordHint(data.passwordMinLength)})`}
					/>
					<!-- Asked twice: a typo here would lock the owner out with nothing to fall back on. -->
					<input
						name="personPasswordConfirm"
						type="password"
						autocomplete="new-password"
						disabled={openMode}
						placeholder="Repeat password"
					/>
				</div>
			{/each}
			<button
				type="button"
				class="btn"
				onclick={() => {
					extraRows += 1;
					peopleNames.push('');
					peopleBirthYears.push('');
				}}>➕ Add a person</button
			>
		</fieldset>

		<fieldset>
			<legend class="eyebrow">Sign in</legend>
			<label class="toggle">
				<input type="checkbox" name="openMode" bind:checked={openMode} />
				<span>
					No password — anyone who can reach this can sign in as anyone
					<span class="note">
						— including as the administrator. On a plain-HTTP address that is everyone on your
						network. You can close it later in Settings, and everybody sets a password then.
					</span>
				</span>
			</label>
		</fieldset>

		<fieldset>
			<legend class="eyebrow">Modules — switch off what you do not have</legend>
			{#each Object.entries(modules()) as [key, m] (key)}
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
		/* Four fields per person (name, birth year, password, repeat) need this width
		   or the fourth wraps onto its own row. */
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
	.addresses {
		margin-bottom: var(--space-4);
	}
	.addresses-title {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.addresses ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.addresses li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
	}
	.addresses code {
		font-family: var(--font-mono);
		font-size: var(--text-md);
		color: var(--fg1);
	}
	.addresses .note {
		font-size: var(--text-xs);
		color: var(--fg3);
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
	/* Two columns, four auto-flowing children: name/year on one row, password pair below. */
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
