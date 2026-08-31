<script lang="ts">
	import { tagHue } from '$lib/tag-hue';
	// SPDX-License-Identifier: AGPL-3.0-or-later
	// One transaction, collapsed to a line and expanded to everything.
	//
	// The register used to put every control a row has on the row itself — a
	// category chooser, a Save, a Split, a paperclip and a state pill, on every
	// one of ten rows. Reading the ledger and editing it are different jobs, and
	// paying the price of the second while doing the first made a page of
	// transactions unreadable as a list of transactions.
	//
	// So the face carries only what a row IS — when, what, how much, filed as
	// what — and everything you can DO to it lives under it, on the one row you
	// opened. The one exception is a row that still needs a look: that is a
	// state worth seeing without opening anything, and it is the only state that
	// gets a pill on the face.
	import { enhance } from '$app/forms';
	import CategoryPicker from '$lib/components/CategoryPicker.svelte';
	import Pill from '$lib/components/Pill.svelte';
	import TagInput from '$lib/components/TagInput.svelte';
	import { REVIEW_HUES, REVIEW_LABELS } from '$lib/transactions/filter';

	interface Group {
		key: string;
		label: string;
		items: { id: string; name: string }[];
	}

	let {
		row,
		categories,
		loans,
		knownTags,
		proofLabel,
		open,
		error,
		ontoggle,
		onsplit,
		onreceipts
	}: {
		// The register's serialised row. Typed structurally rather than imported
		// from the loader's return: this component is the shape's only consumer,
		// and a `typeof data.rows[number]` import would tie a component to a route.
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
			/**
			 * The loan this row has already been recorded as paying, or null — and
			 * the two lines it counts as, where the record can divide it: the
			 * interest under the category it is filed with, the principal under the
			 * one that names it. Null halves means the record cannot divide it and
			 * every total behind the row holds it whole.
			 */
			loanPayment: {
				loanId: string;
				loanName: string;
				halves: { key: string; label: string; amount: string; negative: boolean }[] | null;
			} | null;
			ruleHref: string;
		};
		categories: Group[];
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

	// Whether the category chooser has been asked for. A filed row shows what it
	// is filed as and offers to change it; showing the chooser unasked would put
	// an empty select over an answered question.
	let changing = $state(false);
	let picked = $state<string | null>(null);

	// Whether the loan-payment form has been asked for, on the same reasoning as
	// `changing` above: most debits are not instalments, so a select and an
	// amount box under every one of them would be a form nobody asked for.
	let recording = $state(false);
	// Only the loans this debit could actually have paid. The mutation refuses a
	// payment in a currency the loan is not in rather than guessing a rate, so
	// offering one here would be offering a refusal — and with the list down to
	// one currency, the unit printed beside the interest box is simply the row's.
	const payableLoans = $derived(loans.filter((l) => l.currency === row.currency));

	// A row that closes must not reopen mid-correction, and a different row must
	// never inherit this one's half-made choice.
	$effect(() => {
		if (!open) {
			changing = false;
			picked = null;
			recording = false;
		}
	});

	// Offered on money that left an account, when there is a loan for it to have
	// gone to and nothing has claimed it yet. Money that arrived is not an
	// instalment, and a row already recorded carries its chip instead.
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
		<!-- The date the money moved. Where the bank booked it on another day, that
		     day is on the title rather than in a second column: the row is filed
		     under one of them and a register that showed both would be asking
		     somebody to work out which. -->
		<span class="mono t-date" title={row.bookedDate ? `Booked ${row.bookedDate}` : undefined}
			>{row.date}</span
		>

		<span class="t-name">
			<span class="t-merchant">{row.merchant}</span>
			{#if open}
				<span class="t-sub">
					{row.detail ?? row.account}
					{#if row.detail}· {row.account}{/if}
					{#if transferNote}· {transferNote}{/if}
				</span>
			{/if}
		</span>

		<span class="mono t-amount" class:negative={row.negative}>{row.amount}</span>

		<span class="t-category">
			<span class="dot" style="background: var({row.categoryToken})"></span>
			<span class="t-cat-name">{row.categoryLabel ?? 'Uncategorised'}</span>
		</span>

		<span class="t-marks">
			<!-- Amber is the only state that reaches the face. See the note at the
			     top: the rest are the ordinary case, and a pill on every line is
			     noise rather than information. -->
			{#if row.reviewState === 'needs_review' && !row.isSplit}
				<Pill hue={REVIEW_HUES.needs_review}>{REVIEW_LABELS.needs_review}</Pill>
			{/if}
			{#if row.isSplit}
				<Pill hue="purple">split</Pill>
			{/if}
			<!-- On the face rather than in the panel: which loan a debit went to is
			     what the row IS, and it is the answer to "have I recorded this one
			     yet" that a person is scanning the month for. -->
			{#if row.loanPayment}
				<Pill hue="teal">Loan payment · {row.loanPayment.loanName}</Pill>
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
				<!-- The register is a long page and these rows run to the bottom of it,
				     which is where a native select's popup opened downwards past the
				     fold. -->
				<form
					method="POST"
					action="?/file"
					use:enhance={() =>
						async ({ update, result }) => {
							await update();
							// Back to the pill, which now names what was just chosen. Leaving
							// the chooser open reads as a save that did not take.
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
					<!-- Disabled until something is chosen: the placeholder posts an empty
					     category, which the action rejects with a message that used to have
					     nowhere to appear. The row read as an unresponsive button. -->
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

			<!-- The two lines a recorded instalment counts as. Drawn with the split
			     lines' own markup because that is what they are to every total on
			     this screen: the footer and the month above it are summed from
			     these two figures, and a row reading one whole debit under a footer
			     holding half of it had nothing on it that said why. Not a
			     transaction_split row, though — the loan link is what divides it,
			     and the split dialog would drop it. -->
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
					<!-- Carries the counterparty and the filing away with it, so the rule
					     editor opens already describing this row rather than asking you to
					     retype what you were just looking at. -->
					<a class="btn" href={row.ruleHref}>Make a rule</a>
				</div>
			</div>

			<!-- What was recorded, and the way back out of it. Recording is otherwise
			     a one-way door: the duplicate guard refuses a second attempt, so a
			     debit filed against the wrong mortgage stayed filed against it. The
			     face states the same fact as a pill and this is the panel's copy —
			     the row states what it IS on the face and what you can DO to it
			     below, the same division the split pill and the receipt count keep. -->
			{#if row.loanPayment}
				<form method="POST" action="?/unlinkLoanPayment" use:enhance class="tag-chip recorded">
					<input type="hidden" name="transactionId" value={row.id} />
					<span>Loan payment · {row.loanPayment.loanName}</span>
					<button type="submit" aria-label="Unlink loan payment">✕</button>
				</form>
			{/if}

			<!-- The interest box is optional and stays that way: what the bank
			     printed beats anything derived, but a household that only has the
			     instalment should still be able to say the debit was one. Left
			     blank, the cash-flow split works the month out from the schedule. -->
			{#if canRecordLoanPayment && recording}
				<form
					method="POST"
					action="?/loanPayment"
					use:enhance={() =>
						async ({ update, result }) => {
							await update();
							// Back to the chip the row now carries. Leaving the form open
							// reads as a save that did not take.
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

			<!-- What the statement itself said, in the statement's own words. Only
			     rendered when there is something beyond what the face already
			     printed: a row whose whole content is its counterparty has nothing
			     to add here, and an empty rule under every row is a rule that means
			     nothing. -->
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
	/* The face is the row. A grid rather than a flex row so date, amount and
	   category line up down the list — the whole reason to look at a register is
	   to scan one of those columns. */
	.face {
		display: grid;
		grid-template-columns: 96px minmax(0, 1fr) 150px 150px auto;
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
		background: var(--card3, var(--card2));
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
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.t-merchant {
		font-size: var(--text-md);
		color: var(--fg1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.t-sub {
		font-size: var(--text-xs);
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
		/* Wraps rather than nowrap: a figure too long for the column would
		   otherwise run out of its cell and take the page into sideways scroll. */
		overflow-wrap: anywhere;
	}
	.t-amount.negative {
		color: var(--red);
	}
	.t-category {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-width: 0;
		font-size: var(--text-sm);
		color: var(--fg2);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
	}
	.t-cat-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.t-marks {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
		line-height: 1;
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
	/* One line where there is room for one, wrapping rather than shrinking the
	   loan's name into something unreadable when there is not. */
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
	/* A chip in a column: without this it would stretch the width of the panel.
	   Tinted like the pill on the face, the way a tag chip is tinted by its own
	   hue, so the two readings of the same fact look like one fact. */
	.recorded {
		align-self: flex-start;
		color: var(--teal);
		border-color: color-mix(in srgb, var(--teal) 45%, transparent);
	}
	/* The lines of a split, shown under the transaction they divide. */
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
		/* Two lines rather than five squeezed columns: when, what and how much on
		   the first, what it is filed as on the second. */
		.face {
			grid-template-columns: 96px minmax(0, 1fr) auto;
		}
		.t-category {
			grid-column: 2;
		}
		.t-marks {
			grid-column: 3;
		}
		.panel {
			padding-left: var(--space-6);
		}
	}
</style>
