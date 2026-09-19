<script lang="ts">
	import { tagHue } from '$lib/tag-hue';
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// The face carries only what a row IS — when, what, how much, filed as
	// what — while everything you can DO to it lives in the opened panel. The
	// one exception is `needs_review`, which gets a pill on the face too.
	import { enhance } from '$app/forms';
	import CategoryPicker from '$lib/components/CategoryPicker.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import { REVIEW_HUES, REVIEW_LABELS } from '$lib/transactions/filter';
	import { UNTRACKED_ACCOUNT } from '$lib/import/transfer-target';

	interface Group {
		key: string;
		label: string;
		items: { id: string; name: string }[];
	}

	let {
		row,
		categories,
		accounts,
		loans,
		knownTags,
		proofLabel,
		open,
		error,
		ontoggle,
		onsplit,
		onreceipts
	}: {
		// Typed structurally rather than imported from the loader's return, so
		// this component isn't tied to a route.
		row: {
			id: string;
			/** The day the money moved, which is the day the register files it under. */
			date: string;
			/** The day the bank booked it, when that is a different day; else null. */
			bookedDate: string | null;
			merchant: string;
			detail: string | null;
			amount: string;
			negative: boolean;
			categoryId: string | null;
			categoryLabel: string | null;
			categoryToken: string;
			reviewState: keyof typeof REVIEW_LABELS;
			account: string;
			/** The account the money left, excluded from the "moved to" picker. */
			accountId: string;
			/** The transaction's own currency code, which loans are matched against. */
			currency: string;
			isTransfer: boolean;
			transferKind: 'paired' | 'one-sided' | null;
			readAs: string | null;
			isSplit: boolean;
			splits: {
				id: string;
				amount: string;
				negative: boolean;
				categoryLabel: string | null;
				note: string | null;
				tags: { id: string; name: string }[];
			}[];
			tags: { id: string; name: string; direct: boolean }[];
			documents: { id: string }[];
			/** The loan this row has already been recorded as paying, or null.
			 *  `halves` splits it into interest/principal lines; null means the
			 *  record can't divide it and totals hold it whole. */
			loanPayment: {
				loanId: string;
				loanName: string;
				halves: { key: string; label: string; amount: string; negative: boolean }[] | null;
			} | null;
			ruleHref: string;
		};
		categories: Group[];
		/** Open accounts a transfer could have gone to. */
		accounts: { id: string; name: string }[];
		/**
		 * The loans a debit can be recorded against — empty when the module is off
		 * or nothing is still owed, which is what hides the action entirely.
		 */
		loans: { id: string; name: string; currency: string }[];
		knownTags: { id: string; name: string }[];
		/** What the row's proof class is called, when it has one. */
		proofLabel: string | null;
		open: boolean;
		/** A failure that named this row, or null. */
		error: string | null;
		ontoggle: () => void;
		onsplit: () => void;
		onreceipts: () => void;
	} = $props();

	// Whether the category chooser has been asked for — a filed row shows what
	// it's filed as, not an unasked-for empty select.
	let changing = $state(false);
	let picked = $state<string | null>(null);

	let recording = $state(false);
	/** Whether the "was this an own transfer?" picker has been asked for. */
	let moving = $state(false);
	// Only loans in this debit's own currency — the mutation refuses a
	// cross-currency payment rather than guessing a rate.
	const payableLoans = $derived(loans.filter((l) => l.currency === row.currency));

	// A row that closes must not reopen mid-correction, and a different row
	// must never inherit this one's half-made choice.
	$effect(() => {
		if (!open) {
			changing = false;
			picked = null;
			recording = false;
			moving = false;
		}
	});

	// Only for money that left an account, with an unclaimed loan to record against.
	const canRecordLoanPayment = $derived(
		payableLoans.length > 0 && row.negative && row.loanPayment === null
	);

	const transferNote = $derived(
		!row.isTransfer
			? null
			: row.transferKind === 'one-sided'
				? 'own transfer (one side)'
				: 'own transfer'
	);
</script>

<div class="txn" class:open>
	<button type="button" class="face" aria-expanded={open} onclick={ontoggle}>
		<!-- Where the bank booked it on another day, that day is in the title
		     rather than a second column — the row is filed under one date. -->
		<span class="mono t-date" title={row.bookedDate ? `Booked ${row.bookedDate}` : undefined}
			>{row.date}</span
		>

		<span class="t-name">
			<!-- A bar, not a dot: at 8×22 it reads down a list as a stripe of
			     colour, making the register scannable without reading a word. -->
			<span class="cat-bar" style="background: var({row.categoryToken})" aria-hidden="true"></span>
			<span class="t-names">
				<span class="t-merchant">{row.merchant}</span>
				<span class="t-sub">
					{row.detail ?? row.account}
					{#if row.detail}· {row.account}{/if}
					{#if transferNote}· {transferNote}{/if}
				</span>
			</span>
		</span>

		<!-- Same hue as the bar to its left, tying the stripe down the register to a name. -->
		<span class="t-category" style="--cat: var({row.categoryToken})">
			{row.categoryLabel ?? 'Uncategorised'}
		</span>

		<span class="mono t-amount" class:negative={row.negative}>{row.amount}</span>

		<span class="t-marks">
			{#if row.reviewState === 'needs_review' && !row.isSplit}
				<Pill hue={REVIEW_HUES.needs_review}>{REVIEW_LABELS.needs_review}</Pill>
			{/if}
			{#if row.isSplit}
				<Pill hue="purple">split</Pill>
			{/if}
			{#if row.loanPayment}
				<!-- Full name is in the title; the pill truncates to its column. -->
				<span class="mark" title="Loan payment · {row.loanPayment.loanName}">
					<Pill hue="teal">Loan · {row.loanPayment.loanName}</Pill>
				</span>
			{/if}
			{#if row.documents.length > 0}
				<span class="clip" title="{row.documents.length} filed against this row">
					📎{row.documents.length}
				</span>
			{/if}
		</span>
	</button>

	{#if open}
		<div class="panel">
			{#if error}
				<p class="row-error" role="alert">{error}</p>
			{/if}

			{#if row.isSplit}
				<ul class="splits">
					{#each row.splits as s (s.id)}
						<li class="split-line">
							<span class="s-category">{s.categoryLabel ?? 'Uncategorised'}</span>
							{#if s.tags.length > 0}
								<span class="s-note">{s.tags.map((tag) => `#${tag.name}`).join(' · ')}</span>
							{/if}
							{#if s.note}<span class="s-note">{s.note}</span>{/if}
							<span class="mono s-amount" class:negative={s.negative}>{s.amount}</span>
						</li>
					{/each}
				</ul>
			{:else if changing}
				<form
					method="POST"
					action="?/file"
					use:enhance={() =>
						async ({ update, result }) => {
							await update();
							if (result.type === 'success') changing = false;
						}}
					class="cat-form"
				>
					<input type="hidden" name="id" value={row.id} />
					<CategoryPicker
						name="categoryId"
						groups={categories}
						value={row.categoryId}
						onpick={(id) => (picked = id)}
					/>
					<button type="submit" class="btn btn-primary" disabled={!(picked ?? row.categoryId)}>
						Save
					</button>
					<button type="button" class="btn" onclick={() => (changing = false)}>Cancel</button>
				</form>
			{:else}
				<div class="filed">
					<Pill hue={REVIEW_HUES[row.reviewState]}>
						{row.categoryLabel ?? 'Uncategorised'} · {REVIEW_LABELS[row.reviewState]}
					</Pill>
					<button type="button" class="btn" onclick={() => (changing = true)}>
						{row.categoryLabel ? 'Something else…' : 'File it…'}
					</button>
				</div>
			{/if}

			<!-- Not a transaction_split row — the loan link divides it, and the
			     split dialog would drop it. Drawn with split-line markup because
			     that's what these two figures are to every total on this screen. -->
			{#if !row.isSplit && row.loanPayment?.halves}
				<ul class="splits">
					{#each row.loanPayment.halves as h (h.key)}
						<li class="split-line">
							<span class="s-category">{h.label}</span>
							<span class="mono s-amount" class:negative={h.negative}>{h.amount}</span>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="doings">
				<div class="tags">
					{#each row.tags as t (t.id)}
						{#if t.direct}
							<form
								method="POST"
								action="?/tags"
								use:enhance
								class="tag-chip"
								style:color="var({tagHue(t.name)})"
								style:border-color="color-mix(in srgb, var({tagHue(t.name)}) 45%, transparent)"
							>
								<input type="hidden" name="id" value={row.id} />
								<input type="hidden" name="removeTag" value={t.name} />
								<span>{t.name}</span>
								<button type="submit" aria-label="Remove tag {t.name}">✕</button>
							</form>
						{:else}
							<span
								class="tag-chip"
								title="This tag belongs to a split line"
								style:color="var({tagHue(t.name)})"
								style:border-color="color-mix(in srgb, var({tagHue(t.name)}) 45%, transparent)"
								>{t.name}</span
							>
						{/if}
					{/each}
					<form method="POST" action="?/tags" use:enhance>
						<input type="hidden" name="id" value={row.id} />
						<TagInput transactionId={row.id} known={knownTags} />
					</form>
				</div>

				<div class="actions">
					{#if row.isSplit}
						<button type="button" class="btn" onclick={onsplit}>Edit split</button>
						<form method="POST" action="?/unsplit" use:enhance>
							<input type="hidden" name="id" value={row.id} />
							<button type="submit" class="btn">Remove split</button>
						</form>
					{:else}
						<button type="button" class="btn" onclick={onsplit}>Split</button>
					{/if}
					<button type="button" class="btn" onclick={onreceipts}>
						📎 Receipt{#if row.documents.length > 0}<span class="count">{row.documents.length}</span
							>{/if}
					</button>
					{#if canRecordLoanPayment}
						<button type="button" class="btn" onclick={() => (recording = !recording)}>
							Record as loan payment
						</button>
					{/if}
					{#if !row.isTransfer && !moving}
						<!-- The one direction the register could not go. A row filed under
						     a category may still have been money moving between two of
						     your own accounts, and answering anything on Import takes the
						     row out of the only queue that ever asked. -->
						<button type="button" class="btn" onclick={() => (moving = true)}>
							Own transfer…
						</button>
					{/if}
					<a class="btn" href={row.ruleHref}>Make a rule</a>
				</div>
			</div>

			<!-- The way back out: the duplicate guard otherwise makes recording a
			     one-way door, so a debit filed against the wrong loan stays filed. -->
			{#if row.loanPayment}
				<form method="POST" action="?/unlinkLoanPayment" use:enhance class="tag-chip recorded">
					<input type="hidden" name="transactionId" value={row.id} />
					<span>Loan payment · {row.loanPayment.loanName}</span>
					<button type="submit" aria-label="Unlink loan payment">✕</button>
				</form>
			{/if}

			<!-- The same way back out, for the same reason: marking a row "not
			     spending" takes it off the Import queue, so the screen that asked
			     the question can no longer be asked to unask it. A matched pair is
			     not offered here — that one is evidenced by two statements rather
			     than asserted, and is undone by rejecting the pair. -->
			{#if row.transferKind === 'one-sided'}
				<form method="POST" action="?/clearTransfer" use:enhance class="tag-chip recorded">
					<input type="hidden" name="transactionId" value={row.id} />
					<span>Own transfer · not spending</span>
					<button type="submit" aria-label="No longer a transfer">✕</button>
				</form>
			{:else if row.transferKind === 'paired'}
				<!-- Stated rather than left implicit. A matched pair carries no
				     category and cannot be given one, so without this the row
				     showed "Uncategorised" and looked like something still to do.
				     No ✕: this one is evidenced by two statements rather than
				     asserted by a person, so it is not undone by one click here. -->
				<span class="tag-chip recorded matched">Own transfer · matched to its other leg</span>
			{/if}

			{#if moving}
				<!-- Asked the same way the Import queue asks it, wording included:
				     "to" or "from" by the SIGN of the row, so money arriving is not
				     asked which account it was moved TO while you are looking at the
				     account it arrived in. -->
				<form method="POST" action="?/markTransfer" use:enhance class="move-form">
					<input type="hidden" name="transactionId" value={row.id} />
					<label class="move-phrase">
						<span>{row.negative ? 'Moved to' : 'Came from'}</span>
						<select
							name="toAccountId"
							required
							aria-label={row.negative
								? 'Which of your accounts it went to'
								: 'Which of your accounts it came from'}
						>
							<option value="" disabled selected>which account?</option>
							{#each accounts.filter((a) => a.id !== row.accountId) as a (a.id)}
								<option value={a.id}>{a.name}</option>
							{/each}
							<option value={UNTRACKED_ACCOUNT}>another account · closed or not tracked</option>
						</select>
					</label>
					<button type="submit" class="btn">Not spending</button>
					<button type="button" class="btn" onclick={() => (moving = false)}>Cancel</button>
				</form>
			{/if}

			<!-- Interest is optional: left blank, the cash-flow split works the
			     month out from the schedule instead. -->
			{#if canRecordLoanPayment && recording}
				<form
					method="POST"
					action="?/loanPayment"
					use:enhance={() =>
						async ({ update, result }) => {
							await update();
							if (result.type === 'success') recording = false;
						}}
					class="loan-form"
				>
					<input type="hidden" name="transactionId" value={row.id} />
					<select name="loanId" aria-label="Loan this payment went to">
						{#each payableLoans as l (l.id)}
							<option value={l.id}>{l.name}</option>
						{/each}
					</select>
					<input
						class="mono interest"
						name="interest"
						inputmode="decimal"
						placeholder="Interest part (optional)"
						aria-label="Interest part of this payment"
					/>
					<span class="mono unit">{row.currency}</span>
					<button type="submit" class="btn btn-primary">Save</button>
				</form>
			{/if}

			{#if row.detail || row.readAs}
				<p class="mono provenance">
					{#if row.detail}{row.detail}{/if}
					{#if row.detail && row.readAs}·{/if}
					{#if row.readAs}<span class="read" title={proofLabel ?? undefined}>{row.readAs}</span
						>{/if}
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.txn {
		border-bottom: 1px solid var(--bd);
	}
	.txn:last-of-type {
		border-bottom: 0;
	}
	/* Grid, not flex, so date/amount/category line up down the list. */
	.face {
		display: grid;
		grid-template-columns: 92px minmax(0, 1fr) 170px 130px 120px;
		align-items: center;
		gap: var(--space-5);
		width: 100%;
		min-width: 0;
		padding: 8px var(--space-6);
		background: none;
		border: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.face:hover {
		background: var(--surface-2);
	}
	.txn.open .face {
		background: var(--card3, var(--card2));
	}
	.t-date {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.t-name {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		min-width: 0;
	}
	.t-names {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.t-merchant {
		font-weight: 500;
		font-size: var(--text-md);
		color: var(--fg1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.t-sub {
		font-size: 11.5px;
		color: var(--fg3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.t-amount {
		font-size: var(--text-md);
		font-weight: 600;
		text-align: right;
		color: var(--green);
		/* Wraps rather than pushing the page into sideways scroll. */
		overflow-wrap: anywhere;
	}
	.t-date {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.t-amount.negative {
		color: var(--red);
	}
	/* Own hue, not a neutral chip — this is identity (which category), not state. */
	.t-category {
		display: inline-flex;
		align-items: center;
		justify-self: start;
		max-width: 100%;
		padding: 3px 9px;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--cat) 14%, transparent);
		color: color-mix(in srgb, var(--fg1) var(--series-ink-mix), var(--cat));
		font-size: var(--text-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cat-bar {
		width: 8px;
		height: 22px;
		border-radius: var(--radius-xs);
		flex: none;
	}
	.t-marks {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
		line-height: 1;
		min-width: 0;
	}
	/* A pill carrying a name can be any length, so it's cut with an ellipsis
	   and the full text lives on the title. */
	.mark {
		display: inline-flex;
		min-width: 0;
		max-width: 100%;
	}
	.mark :global(.pill) {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.clip {
		font-size: var(--text-xs);
		color: var(--fg3);
		white-space: nowrap;
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-5) var(--space-6) var(--space-6)
			calc(96px + var(--space-6) + var(--space-5));
		background: var(--card2);
		border-top: 1px solid var(--bd2);
	}
	.row-error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--red);
	}
	.filed {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.cat-form {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.cat-form :global(.picker) {
		flex: 1 1 200px;
		max-width: 320px;
	}
	.doings {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		flex-wrap: wrap;
		border-top: 1px solid var(--bd);
		padding-top: var(--space-5);
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
	}
	.tag-chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		border: 1px solid var(--bd2);
		border-radius: var(--radius-pill);
		padding: 3px 5px 3px 10px;
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.tag-chip button {
		border: 0;
		background: none;
		color: var(--fg3);
		cursor: pointer;
		font-size: var(--text-xs);
		padding: 0 3px;
	}
	.tag-chip button:hover {
		color: var(--fg1);
	}
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.count {
		margin-left: var(--space-3);
		font-size: var(--text-xs);
		color: var(--fg3);
	}
	.loan-form {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.loan-form .interest {
		flex: 1 1 180px;
		max-width: 240px;
	}
	.unit {
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	/* Tinted like the pill on the face, so both readings of the fact match. */
	.recorded {
		align-self: flex-start;
		color: var(--teal);
		border-color: color-mix(in srgb, var(--teal) 45%, transparent);
	}
	/* A statement of fact, not a control: nothing here is pressable. */
	.matched {
		padding: 3px 9px;
	}
	.move-form {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	.move-phrase {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.splits {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.split-line {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-5);
		align-items: baseline;
		font-size: var(--text-md);
	}
	.s-note {
		grid-column: 1;
		font-size: var(--text-sm);
		color: var(--fg3);
	}
	.s-amount {
		font-size: var(--text-md);
		white-space: nowrap;
		color: var(--green);
	}
	.s-amount.negative {
		color: var(--red);
	}
	.provenance {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--fg3);
		overflow-wrap: anywhere;
	}
	.read {
		font-style: italic;
		opacity: 0.85;
	}
	@media (max-width: 720px) {
		.face {
			grid-template-columns: 84px minmax(0, 1fr) auto auto;
		}
		/* The bar down the left already says which category this is. */
		.t-category {
			display: none;
		}
		.t-marks {
			grid-column: 3;
		}
		.panel {
			padding-left: var(--space-6);
		}
	}
</style>
