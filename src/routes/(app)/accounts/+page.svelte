<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import InfoHint from '$lib/components/InfoHint.svelte';
	import Modal from '$lib/components/Modal.svelte';

	let { data, form } = $props();

	let adding = $state(false);

	/** Sentinel option: not a bank key, so it can never be stored as one. */
	const ADD_BANK = '__add__';
	let bankKey = $state('fio');
	let addingBank = $state(false);
	// What the select should fall back to if the dialog is dismissed, so choosing
	// "Add a bank…" and then changing your mind does not leave the field on a
	// sentinel the server would refuse.
	let bankBefore = $state('fio');

	function onBankChange() {
		if (bankKey === ADD_BANK) {
			addingBank = true;
			bankKey = bankBefore;
		} else {
			bankBefore = bankKey;
		}
	}

	const donutGradient = $derived(
		data.donut.length
			? `conic-gradient(${data.donut.map((s) => `${s.color} ${s.from}% ${s.to}%`).join(', ')})`
			: 'conic-gradient(var(--card3) 0 100%)'
	);
</script>

<ScreenHeader
	title="Accounts"
	caption="Balances stay in their own currency. Only totals convert."
/>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<section class="grid-2">
	<div class="card list">
		<div class="eyebrow-row" style="padding-bottom: 10px;">
			<Eyebrow emoji="🏦" label="Accounts" />
			<span class="eyebrow-caption"
				>native currency · {data.cashTotalFormatted}
				{data.baseCurrencyDisplay} in total</span
			>
		</div>
		{#if data.accounts.length === 0}
			<p class="empty">
				No accounts yet. Add them here, or import a statement — accounts are created from statements
				automatically.
			</p>
		{/if}
		{#each data.accounts as a (a.id)}
			<div class="row">
				<span class="emoji">{a.emoji}</span>
				<div class="names">
					<span class="name">{a.name}</span>
					<span class="meta">{a.meta}</span>
				</div>
				<div class="balances">
					<span class="mono balance">{a.balance}</span>
					{#if a.baseEquivalent}
						<span class="mono equivalent">{a.baseEquivalent}</span>
					{/if}
				</div>
			</div>
		{/each}

		{#if adding}
			<form method="POST" action="?/addAccount" use:enhance class="add-form">
				<input name="name" placeholder="Name (e.g. Fio joint account)" />
				<!-- The list is data now, so a bank added below appears here without a
				     deploy. Picking the sentinel opens the dialog rather than filing the
				     account under a bank literally called Other. -->
				<select name="bank" bind:value={bankKey} onchange={onBankChange}>
					{#each data.banks as b (b.key)}
						<option value={b.key}>{b.label}</option>
					{/each}
					<option value={ADD_BANK}>➕ Add a bank…</option>
				</select>
				<select name="currency">
					{#each data.currencies as c (c)}<option>{c}</option>{/each}
				</select>
				<select name="kind">
					<option value="current">Current</option>
					<option value="savings">Savings</option>
					<option value="brokerage">Brokerage</option>
				</select>
				<!-- The placeholder alone could not say why this is wanted, and on a
				     narrow screen it was cut off before it finished saying what it is. -->
				<div class="numbers-field">
					<input name="numbers" placeholder="Account number(s), comma separated" />
					<InfoHint label="Why account numbers are needed">
						The numbers this account is known by, as your statements print them — an account number
						or an IBAN. Several go in comma separated.
						<br /><br />
						Continuum matches them against the counterparty on every imported row, so money moved between
						two of your own accounts is recognised as a transfer and left out of spending and income.
						Without them, moving savings looks like money spent.
					</InfoHint>
				</div>
				<button type="submit" class="btn">Add</button>
			</form>
		{:else}
			<button type="button" class="btn add-btn" onclick={() => (adding = true)}
				>➕ Add account</button
			>
		{/if}
	</div>

	<div class="card sits">
		<Eyebrow emoji="🥧" label="Where the cash sits" />
		<div class="donut-wrap">
			<div class="donut" style:background={donutGradient}>
				<div class="hole"><span class="mono">{data.cashTotalFormatted}</span></div>
			</div>
			<div class="legend">
				{#each data.donut as s (s.label)}
					<div class="legend-row">
						<span class="dot" style:background={s.color}></span>
						<span class="legend-label">{s.label}</span>
						<span class="mono legend-pct">{s.pct.toFixed(1)}%</span>
					</div>
				{:else}
					<span class="empty">The split appears once balances are known.</span>
				{/each}
			</div>
		</div>
	</div>
</section>

{#if addingBank}
	<Modal title="Add a bank" onclose={() => (addingBank = false)}>
		<form
			method="POST"
			action="?/addBank"
			use:enhance={() => {
				return async ({ result, update }) => {
					// Select the bank that was just added, so the account form carries on
					// where it left off instead of making the choice a second time.
					if (result.type === 'success' && typeof result.data?.bankKey === 'string') {
						bankKey = result.data.bankKey;
						bankBefore = bankKey;
					}
					addingBank = false;
					await update();
				};
			}}
			class="bank-form"
		>
			<label>
				<span>Name</span>
				<input name="label" placeholder="Komerční banka" required />
			</label>
			<label>
				<span>Emoji</span>
				<input name="emoji" placeholder="🏦" maxlength="4" />
			</label>
			<div class="row">
				<button type="submit" class="btn btn-primary">Add bank</button>
				<button type="button" class="btn" onclick={() => (addingBank = false)}>Cancel</button>
			</div>
		</form>
	</Modal>
{/if}

<section class="card">
	<div class="eyebrow-row" style="padding-bottom: 4px;">
		<Eyebrow emoji="🔁" label="Transfers between your own accounts" />
		<span class="eyebrow-caption">matched automatically · never counted as income or expense</span>
	</div>
	{#each data.transfers as t (t.date + t.route)}
		<div class="transfer-row">
			<span class="mono t-date">{t.date}</span>
			<span class="t-route">{t.route}</span>
			<span class="mono">{t.amount}</span>
		</div>
	{:else}
		<p class="empty">Matched pairs from imported statements will appear here.</p>
	{/each}
</section>

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.grid-2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 16px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.row {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) auto;
		align-items: center;
		gap: 12px;
		padding: 11px 0;
		border-top: 1px solid var(--bd);
	}
	.emoji {
		font-size: var(--text-xl);
	}
	.names {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.name {
		font-size: var(--text-md);
	}
	.meta {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.balances {
		display: flex;
		flex-direction: column;
		gap: 1px;
		text-align: right;
	}
	.balance {
		font-size: var(--text-lg);
	}
	.equivalent {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.empty {
		margin: 0;
		padding: 10px 0;
		font-size: var(--text-md);
		color: var(--fg3);
	}
	.add-btn {
		margin-top: 11px;
		align-self: flex-start;
	}
	.add-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto minmax(0, 1fr) auto;
		gap: 8px;
		padding-top: 11px;
		border-top: 1px solid var(--bd);
	}
	/* Occupies the numbers column of the grid, so the hint travels with the field
	   it explains instead of being parked at the end of the row. */
	.bank-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.bank-form label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.bank-form .row {
		display: flex;
		gap: 8px;
	}
	.numbers-field {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.numbers-field input {
		flex: 1;
	}
	.add-form input,
	.add-form select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: var(--text-md);
		min-width: 0;
	}
	.sits {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.donut-wrap {
		display: flex;
		align-items: center;
		gap: 22px;
		flex-wrap: wrap;
	}
	.donut {
		width: 148px;
		height: 148px;
		border-radius: 148px;
		flex: 0 0 148px;
		display: grid;
		place-items: center;
	}
	.hole {
		width: 88px;
		height: 88px;
		border-radius: 88px;
		background: var(--bg2);
		display: grid;
		place-items: center;
	}
	.hole .mono {
		font-size: var(--text-md);
	}
	.legend {
		flex: 1 1 190px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.legend-row {
		display: grid;
		grid-template-columns: 11px minmax(0, 1fr) auto;
		gap: 9px;
		align-items: center;
		font-size: var(--text-sm);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 3px;
	}
	.legend-label {
		color: var(--fg2);
	}
	.legend-pct {
		color: var(--fg3);
	}
	.transfer-row {
		display: grid;
		grid-template-columns: 62px minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 12px;
		padding: 9px 0;
		border-top: 1px solid var(--bd);
		font-size: var(--text-md);
	}
	.t-date {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.t-route {
		color: var(--fg2);
	}
	@media (max-width: 720px) {
		.add-form {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
</style>
