<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { enhance } from '$app/forms';
	import { shouldCloseAfterAction } from '$lib/actions/result';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';
	import InfoHint from '$lib/components/InfoHint.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import DocumentsCard from '$lib/components/DocumentsCard.svelte';

	let { data, form } = $props();

	let adding = $state(false);

	/** Sentinel option: not a bank key, so it can never be stored as one. */
	const ADD_BANK = '__add__';
	let editing = $state<string | null>(null);
	/** Close on success, stay open on a refusal so a correction is not lost. */
	const closeOnSuccess =
		(close: () => void) =>
		() =>
		async ({
			update,
			result
		}: {
			update: () => Promise<void>;
			result: import('@sveltejs/kit').ActionResult;
		}) => {
			await update();
			if (shouldCloseAfterAction(result.type)) close();
		};

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
			<Eyebrow hue="--teal" emoji="🏦" label="Accounts" />
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
					<div class="name-line">
						<span class="name">{a.name}</span>
						<button
							type="button"
							class="edit"
							aria-label="Edit {a.name}"
							onclick={() => (editing = editing === a.id ? null : a.id)}
						>
							✎
						</button>
					</div>
					<!-- The numbers this account is known by. They were written when it was
					     created AND learned from statements as they arrived, but shown
					     nowhere — so the one thing that explains why a transfer did or did
					     not pair was unreachable. -->
					{#if a.numbers.length > 0}
						<span class="mono numbers">{a.numbers.join(' · ')}</span>
					{/if}
					<span class="meta">{a.meta}</span>
				</div>
				<div class="balances">
					<span class="mono balance">{a.balance}</span>
					{#if a.baseEquivalent}
						<span class="mono equivalent">{a.baseEquivalent}</span>
					{/if}
				</div>
			</div>

			<!-- Nested inside the shared `.card list`, so `bare` drops the
			     card-in-card border and padding — the list's own card supplies
			     both. `.list` has no gap of its own, so like `.row` and
			     `.edit-form`, `.doc-block` draws its own top border: it is what
			     separates this account's row, above, from its own documents
			     block, below — the same rule the next account's `.row` uses to
			     separate itself from this one. No `addHref`: an imported
			     statement files itself, and a brokerage report is added from
			     Investments, so this card only ever attaches what already exists. -->
			<div class="doc-block">
				<DocumentsCard
					bare
					heading="Statements and reports"
					documents={a.documents}
					target={{ id: a.id, kind: 'account', label: a.name }}
					emptyText="Nothing filed for this account yet — statements arrive by importing them, and a brokerage report is added from Investments."
					attach={{ action: 'attachDocument', candidates: a.documentCandidates }}
					detachAction="detachDocument"
					isAdmin={data.isAdmin}
				/>
			</div>

			{#if editing === a.id}
				<form
					method="POST"
					action="?/editAccount"
					use:enhance={closeOnSuccess(() => (editing = null))}
					class="edit-form"
				>
					<input type="hidden" name="id" value={a.id} />
					<label class="field"><span>Name</span><input name="name" value={a.name} /></label>
					<label class="field"><span>Emoji</span><input name="emoji" value={a.ownEmoji} /></label>
					<label class="field">
						<span>Bank</span>
						<select name="bank" value={a.bank}>
							{#each data.banks as b (b.key)}<option value={b.key}>{b.label}</option>{/each}
						</select>
					</label>
					<label class="field">
						<span>Type</span>
						<select name="kind" value={a.kind}>
							<option value="current">Current</option>
							<option value="savings">Savings</option>
							<option value="brokerage">Brokerage</option>
						</select>
					</label>
					<label class="field">
						<span>Whose</span>
						<select name="ownerPersonId" value={a.ownerPersonId ?? ''}>
							<!-- Joint is a real answer, not an absence — which is all it was
							     until now, because nothing ever set an owner. -->
							<option value="">Joint</option>
							{#each data.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
						</select>
					</label>
					<label class="field">
						<span>Currency</span>
						<!-- Locked once anything is filed here: every stored amount is minor
						     units OF THIS CURRENCY, so changing it would reinterpret history
						     rather than convert it. The server refuses it too; this only
						     avoids offering something that will be refused. -->
						<select name="currency" value={a.currency} disabled={!a.canChangeCurrency}>
							{#each data.currencies as c (c)}<option>{c}</option>{/each}
						</select>
					</label>
					<label class="field numbers-field">
						<span>Account number(s)</span>
						<input name="numbers" value={a.numbers.join(', ')} />
					</label>
					<div class="edit-actions">
						<button type="button" class="btn" onclick={() => (editing = null)}>Cancel</button>
						<button type="submit" class="btn btn-primary">Save</button>
					</div>
				</form>
			{/if}
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
				<select name="ownerPersonId" aria-label="Whose account this is">
					<option value="">Joint</option>
					{#each data.people as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
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

	<div class="card transfers">
		<div class="eyebrow-row" style="padding-bottom: 4px;">
			<Eyebrow hue="--teal" emoji="🔁" label="Transfers between your own accounts" />
			<span class="eyebrow-caption">matched automatically · never counted as income or expense</span
			>
		</div>
		{#each data.transfers as t (t.id)}
			<div class="transfer-row">
				<span class="mono t-date">{t.date}</span>
				<span class="t-route">{t.route}</span>
				<span class="mono">{t.amount}</span>
			</div>
		{:else}
			<p class="empty">Matched pairs from imported statements will appear here.</p>
		{/each}
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

<section class="card sits">
	<Eyebrow hue="--teal" emoji="🥧" label="Where the cash sits">
		{#snippet right()}
			<!-- The total moves out of the hole and into the header. It was set in
			     13px type inside an 88px disc, which is the smallest a figure this
			     important is printed anywhere in the app — and the disc it sat in
			     was the reason the chart had a hole at all. -->
			<span class="sits-total display">{data.cashTotalFormatted}</span>
		{/snippet}
	</Eyebrow>
	<div class="donut-wrap">
		<div class="pie" style:background={donutGradient}></div>
		<div class="legend">
			{#each data.donut as s (s.id)}
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
</section>

<style>
	.numbers {
		font-size: var(--text-xs);
		color: var(--fg3);
		overflow-wrap: anywhere;
	}
	.name-line {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.edit {
		background: none;
		border: 0;
		color: var(--fg3);
		cursor: pointer;
		font-size: var(--text-md);
		line-height: 1;
		padding: 0;
		flex: none;
	}
	.edit:hover {
		color: var(--fg1);
	}
	.edit-form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: var(--space-6);
		padding: var(--space-6) 0;
		border-top: 1px solid var(--bd);
	}
	/* `.list` has no gap of its own — every row draws its own top border — so
	   this block, sitting between a row and the next one, does the same. */
	.doc-block {
		padding: var(--space-6) 0;
		border-top: 1px solid var(--bd);
	}
	.edit-actions {
		display: flex;
		align-items: flex-end;
		justify-content: flex-end;
		gap: var(--space-4);
	}

	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: var(--radius-xl);
		padding: 9px 14px;
		font-size: var(--text-md);
	}
	.grid-2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: var(--space-8);
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
		gap: var(--space-6);
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
		gap: var(--space-4);
		padding-top: 11px;
		border-top: 1px solid var(--bd);
	}
	/* Occupies the numbers column of the grid, so the hint travels with the field
	   it explains instead of being parked at the end of the row. */
	.bank-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
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
		gap: var(--space-4);
	}
	.numbers-field {
		display: flex;
		align-items: center;
		gap: var(--space-3);
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
		border-radius: var(--radius-md);
		padding: 8px 11px;
		font-size: var(--text-md);
		min-width: 0;
	}
	.sits {
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}
	.transfers {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.donut-wrap {
		display: flex;
		align-items: center;
		gap: 22px;
		flex-wrap: wrap;
	}
	/* A pie, not a donut. With the total moved to the header the hole held
	   nothing, and a ring reads a share less directly than a wedge does. */
	.pie {
		width: 140px;
		height: 140px;
		border-radius: var(--radius-pill);
		flex: 0 0 140px;
	}
	.sits-total {
		font-size: var(--text-2xl);
	}
	.legend {
		/* Full width now, so the rows spread across the row instead of stacking in a
		   single narrow column with the rest of the card left blank. */
		flex: 1 1 190px;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
		gap: var(--space-4) var(--space-8);
		align-content: center;
	}
	.legend-row {
		display: grid;
		grid-template-columns: 11px minmax(0, 1fr) auto;
		gap: 9px;
		align-items: center;
		font-size: var(--text-sm);
	}
	/* Square, matching every other swatch in the app: a round dot beside a
	   category name read as a bullet rather than as the wedge's colour. */
	.dot {
		width: 10px;
		height: 10px;
		border-radius: var(--radius-xs);
	}
	.legend-label {
		color: var(--fg2);
	}
	.legend-pct {
		color: var(--fg3);
	}
	.transfer-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: baseline;
		gap: var(--space-6);
		padding: 9px 0;
		border-top: 1px solid var(--bd);
		font-size: var(--text-md);
	}
	.t-date {
		font-size: var(--text-sm);
		color: var(--fg3);
		white-space: nowrap;
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
