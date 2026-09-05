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

<ScreenHeader title="Accounts" caption="Balances stay in their own currency. Only totals convert.">
	{#snippet actions()}
		{#if !adding}
			<button type="button" class="btn btn-primary" onclick={() => (adding = true)}>
				Add account
			</button>
		{/if}
	{/snippet}
</ScreenHeader>

<!-- The line over both columns, so the first account card and the pie beside
     it start on the same edge. It sat inside the left column, which pushed the
     cards a row under the panel they are counted in. -->
<div class="list-head">
	<span class="list-title"
		>Accounts <span class="list-note"
			>native currency · {data.cashTotalFormatted}
			{data.baseCurrencyDisplay} in total</span
		></span
	>
</div>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<!-- Two columns: the accounts themselves, and what they add up to. The pie used
     to sit in a section of its own below the list, which put the answer to
     "where is the money" a scroll away from the money. -->
<section class="cols">
	<div class="left">
		{#if data.accounts.length === 0}
			<p class="empty">
				No accounts yet. Add them here, or import a statement — accounts are created from statements
				automatically.
			</p>
		{/if}

		{#each data.accounts as a (a.id)}
			<!-- One card per account, not a row in a shared list: an account is a
			     thing with a balance, and the share bar under its name is the same
			     figure as its wedge in the pie beside it. -->
			<article class="acct" class:open={editing === a.id}>
				<span class="acct-tile" style:background="color-mix(in srgb, {a.color} 18%, transparent)"
					>{a.emoji}</span
				>
				<span class="acct-mid">
					<span class="name-line">
						<span class="name">{a.name}</span>
						<button
							type="button"
							class="edit"
							aria-label="Edit {a.name}"
							aria-expanded={editing === a.id}
							onclick={() => (editing = editing === a.id ? null : a.id)}
						>
							✎
						</button>
					</span>
					<span class="meta">{a.meta}</span>
					{#if a.share !== null}
						<span class="share">
							<span class="bar"
								><span class="fill" style:width="{a.share}%" style:background={a.color}
								></span></span
							>
							<span class="mono share-pct">{a.share.toFixed(1)}%</span>
						</span>
					{/if}
				</span>
				<span class="acct-bal">
					<span class="display balance">{a.balance}<span class="ccy">{a.currency}</span></span>
					{#if a.baseEquivalent}<span class="mono equivalent">{a.baseEquivalent}</span>{/if}
				</span>
			</article>

			{#if editing === a.id}
				<!-- Everything about this account that is not its balance: the fields
				     that name it, the numbers a transfer is matched on, and the paper
				     filed against it. Behind the pencil, because a card that always
				     showed its statements pushed the next account off the screen. -->
				<div class="panel">
					{#if a.numbers.length > 0}
						<!-- The numbers this account is known by, written when it was
						     created AND learned from statements as they arrived. Shown
						     nowhere until now, so the one thing that explains why a
						     transfer did or did not pair was unreachable. -->
						<span class="mono numbers">{a.numbers.join(' · ')}</span>
					{/if}
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
		{/if}
	</div>

	<div class="right">
		<section class="card sits">
			<Eyebrow hue="--teal" icon="chart" label="Where the cash sits">
				{#snippet right()}
					<!-- The total moves out of the hole and into the header. It was set in
					     13px type inside an 88px disc, which is the smallest a figure this
					     important is printed anywhere in the app — and the disc it sat in
					     was the reason the chart had a hole at all. -->
					<span class="sits-total display"
						>{data.cashTotalFormatted}<span class="ccy">{data.baseCurrencyDisplay}</span></span
					>
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

		<section class="card transfers">
			<Eyebrow hue="--teal" icon="rotate" label="Transfers between your own accounts" />
			<p class="transfers-note">Matched automatically, never counted as income or expense.</p>
			{#each data.transfers as t (t.id)}
				<div class="transfer-row">
					<span class="mono t-date">{t.date}</span>
					<span class="t-route">{t.route}</span>
					<span class="mono">{t.amount}</span>
				</div>
			{:else}
				<p class="empty">Matched pairs from imported statements will appear here.</p>
			{/each}
		</section>
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

<style>
	/* 1.35fr / 1fr, the design's split: the list needs room for a name, a meta
	   line and a balance; the pie beside it does not. */
	.cols {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
		gap: var(--space-8);
		align-items: start;
	}
	.left,
	.right {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-width: 0;
	}
	.list-head {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		padding: 0 var(--space-2);
		margin-bottom: var(--space-6);
		flex-wrap: wrap;
	}
	.list-title {
		font-size: var(--text-lg);
		font-weight: 600;
	}
	.list-note {
		font-size: var(--text-sm);
		font-weight: 400;
		color: var(--fg3);
		margin-left: var(--space-3);
	}

	.acct {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--space-7);
		background: var(--surface);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: var(--space-8) 18px;
		transition:
			transform var(--dur) var(--ease),
			border-color var(--dur) var(--ease);
	}
	.acct:hover {
		transform: translateY(-1px);
	}
	/* While its panel is open the card and the panel are one shape. */
	.acct.open {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
		border-bottom-color: transparent;
		transform: none;
	}
	.acct-tile {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 13px;
		font-size: var(--text-2xl);
		line-height: 1;
	}
	.acct-mid {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.name-line {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-width: 0;
	}
	.name {
		font-size: var(--text-lg);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.edit {
		background: none;
		border: 0;
		color: var(--fg3);
		cursor: pointer;
		font-size: var(--text-sm);
		line-height: 1;
		padding: 0;
		flex: none;
	}
	.edit:hover {
		color: var(--fg1);
	}
	.meta {
		font-size: var(--text-sm);
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The same figure as this account's wedge in the pie, said twice on purpose:
	   beside the name it answers "how much of our cash is here" without moving
	   the eye to the chart. */
	.share {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin-top: var(--space-2);
	}
	.bar {
		flex: 1;
		height: 5px;
		border-radius: 3px;
		background: var(--card3);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
	}
	.share-pct {
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.acct-bal {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-1);
		text-align: right;
	}
	.balance {
		font-size: var(--text-3xl);
	}
	.ccy {
		font-size: var(--text-sm);
		font-weight: 500;
		letter-spacing: 0;
		color: var(--fg3);
		margin-left: 5px;
	}
	.equivalent {
		font-size: var(--text-xs);
		color: var(--fg3);
	}

	/* Hangs off the bottom of the card it belongs to. */
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		background: var(--surface);
		border: 1px solid var(--bd);
		border-top: 0;
		border-radius: 0 0 var(--radius-card) var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 0 18px var(--space-8);
		margin-top: calc(var(--space-6) * -1);
	}
	.numbers {
		font-size: var(--text-xs);
		color: var(--fg3);
		overflow-wrap: anywhere;
	}

	.sits-total {
		font-size: var(--text-2xl);
	}
	/* A pie, not a donut. With the total moved to the header the hole held
	   nothing, and a ring reads a share less directly than a wedge does. */
	.pie {
		width: 140px;
		height: 140px;
		border-radius: var(--radius-pill);
		flex: 0 0 140px;
	}
	.donut-wrap {
		display: flex;
		align-items: center;
		gap: 22px;
		flex-wrap: wrap;
	}
	.legend {
		flex: 1 1 150px;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}
	.legend-row {
		display: grid;
		grid-template-columns: 10px minmax(0, 1fr) auto;
		gap: var(--space-5);
		align-items: center;
		font-size: var(--text-md);
	}
	/* Square, matching every other swatch in the app: a round dot beside a name
	   read as a bullet rather than as the wedge's colour. */
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 3px;
	}
	.legend-label {
		color: var(--fg2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.legend-pct {
		color: var(--fg3);
	}
	.transfers,
	.sits {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.transfers-note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--fg3);
		line-height: 1.5;
	}

	@media (max-width: 1023px) {
		.cols {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 719px) {
		.acct {
			grid-template-columns: 44px minmax(0, 1fr);
			gap: var(--space-5);
		}
		.acct-bal {
			grid-column: 2;
			align-items: flex-start;
			text-align: left;
		}
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
