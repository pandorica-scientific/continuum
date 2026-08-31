// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pairing transfers and categorising, as one pass over a bounded window.
 *
 * Lifted out of `ingest.ts`, which had grown to twelve hundred lines behind five
 * exports while every other file in this domain stayed small. This half is a
 * genuinely separate job: `ingestFile` turns a file into rows, and this turns
 * rows that already exist into pairs and categories. The proof of that is that
 * four callers outside importing — a rule being saved, a transaction being
 * edited, a transfer decision, the rules screen — want this and not the reading.
 *
 * It runs after each file so cross-file pairs appear as soon as the second leg
 * arrives. Only auto pairs — the ones on hard evidence — are excluded from the
 * figures immediately; review proposals stay in income and spending until the
 * household confirms them.
 */
import { uuidv7 } from 'uuidv7';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db, inTransaction, type Queryable } from '$lib/server/db';
import {
	account,
	currencyRate,
	person,
	transaction,
	transactionSplit,
	transferPair
} from '$lib/server/db/schema';
import { convertMinorSync, type RateTable } from '$lib/server/fx/table';
import { decideWithRules } from '$lib/rules/match';
import { autoThreshold, loadRules } from '$lib/server/rules';
import { addTagsToTransaction } from '$lib/server/tags';
import { notOwnTransfer } from '$lib/server/transactions/transfers';
import { normaliseAccountKey, proposePairs, type PairableTx } from './pairing';

/** Inclusive ISO-day bounds a pairing pass may consider. */
interface PairingWindow {
	from: string;
	to: string;
}

// Tier 3 pairs legs up to three days apart, so a week either side covers every
// tier with slack to spare.
const PAIRING_WINDOW_DAYS = 7;

function shiftDay(day: string, delta: number): string {
	const at = new Date(`${day}T00:00:00.000Z`);
	at.setUTCDate(at.getUTCDate() + delta);
	return at.toISOString().slice(0, 10);
}

/**
 * The span a pass has to read to pair anything that just changed.
 *
 * Without one, every filing, import and transfer decision row-locked and
 * compared the entire unpaired ledger: auto-categorised rows stay candidates
 * forever, so the set only grows, and proposePairs is a nested loop over it.
 * The horizon this replaces was anchored to today, which is why it had to go —
 * it silently stopped historical statements pairing at all. Anchoring to the
 * changed rows instead bounds the work without caring how old they are.
 */
export function pairingWindowAround(days: string[]): PairingWindow | null {
	const known = days.filter(Boolean).sort();
	if (known.length === 0) return null;
	return {
		from: shiftDay(known[0], -PAIRING_WINDOW_DAYS),
		to: shiftDay(known[known.length - 1], PAIRING_WINDOW_DAYS)
	};
}

export async function pairAndCategorise(
	handle: Queryable = db,
	window: PairingWindow | null = null
): Promise<number> {
	return inTransaction(handle, (tx) => pairAndCategoriseInTransaction(tx, window));
}

export async function lockTransferPairing(handle: Queryable): Promise<void> {
	// Every pairing pass takes this transaction-scoped lock before reading any
	// candidates. If opposite legs arrive in concurrent import transactions,
	// the second pass waits for the first commit and then sees both movements.
	await handle.execute(
		sql`select pg_advisory_xact_lock(hashtextextended('continuum:transfer-pairing', 0))`
	);
}

async function pairAndCategoriseInTransaction(
	handle: Queryable,
	window: PairingWindow | null = null
): Promise<number> {
	await lockTransferPairing(handle);

	const accounts = await handle.select().from(account);
	const people = await handle.select({ name: person.name }).from(person);
	const rateRows = await handle.select().from(currencyRate);
	const rates: RateTable = new Map();
	for (const row of rateRows) {
		const list = rates.get(row.code) ?? [];
		list.push({ day: row.day, rate: Number(row.rate) });
		rates.set(row.code, list);
	}
	for (const list of rates.values()) list.sort((a, b) => (a.day < b.day ? 1 : -1));

	// Candidate legs: unpaired and not already part of a pending proposal (else
	// every run would re-propose the same pairs). Do not use a wall-clock cutoff:
	// historical statement imports need the same exact-evidence pairing.
	const pendingPairs = await handle.select().from(transferPair);
	const legsInPairs = new Set(pendingPairs.flatMap((p) => [p.outTransactionId, p.inTransactionId]));
	const candidates = (
		await handle
			.select()
			.from(transaction)
			.where(
				and(
					isNull(transaction.transferPairId),
					sql`${transaction.reviewState} not in ('confirmed', 'filed')`,
					sql`not exists (
						select 1 from ${transactionSplit} split
						where split.transaction_id = ${transaction.id}
					)`,
					window ? gte(transaction.bookedOn, window.from) : undefined,
					window ? lte(transaction.bookedOn, window.to) : undefined
				)
			)
			.orderBy(asc(transaction.bookedOn), asc(transaction.id))
			.for('update')
	).filter((t) => !legsInPairs.has(t.id));

	const proposals = proposePairs(
		candidates.map((t): PairableTx => ({
			id: t.id,
			accountId: t.accountId,
			bookedOn: t.bookedOn,
			amountMinor: t.amountMinor,
			currency: t.currency,
			counterparty: t.counterparty,
			counterpartyAccount: t.counterpartyAccount
		})),
		{
			accounts: accounts.map((a) => ({
				id: a.id,
				currency: a.currency,
				numberKeys: a.numbers.map(normaliseAccountKey)
			})),
			personNames: people.map((p) => p.name),
			convert: (amount, from, to, day) => convertMinorSync(rates, amount, from, to, day)
		}
	);

	let paired = 0;
	for (const proposal of proposals) {
		const pairId = uuidv7();
		if (proposal.confidence === 'auto') {
			await handle.insert(transferPair).values({
				id: pairId,
				outTransactionId: proposal.outId,
				inTransactionId: proposal.inId,
				state: 'auto'
			});
			for (const id of [proposal.outId, proposal.inId]) {
				await handle
					.update(transaction)
					.set({
						transferPairId: pairId,
						reviewState: 'auto',
						reviewReason: null,
						categoryId: null
					})
					.where(eq(transaction.id, id));
			}
			paired += 2;
		} else {
			// Held proposal: no transferPairId, so the legs stay in the figures
			// and in the review queue until confirmed.
			await handle.insert(transferPair).values({
				id: pairId,
				outTransactionId: proposal.outId,
				inTransactionId: proposal.inId,
				state: 'proposed'
			});
			for (const id of [proposal.outId, proposal.inId]) {
				await handle
					.update(transaction)
					.set({
						reviewState: 'needs_review',
						reviewReason: 'looks like a transfer between your own accounts'
					})
					.where(eq(transaction.id, id));
			}
		}
	}

	// Categorise whatever is new and not a transfer (held proposals included —
	// a categorisation would resolve them as "not a transfer").
	const [rules, threshold] = await Promise.all([loadRules(handle), autoThreshold(handle)]);
	// Re-read the proposals rather than reuse the snapshot taken above: the loop
	// that just ran inserts proposals of its own, and a leg waiting on a
	// transfer decision must not be categorised out from under it. Against the
	// stale snapshot, a leg proposed in this very pass could match a rule, flip
	// to reviewState 'auto', and vanish from /import — which lists only
	// 'needs_review'. Its transferPairId would then stay null forever, so both
	// legs kept counting as real income and real spending, and legsInPairs
	// stopped any later run from re-proposing them.
	const undecided = await handle
		.select()
		.from(transaction)
		// `notOwnTransfer()` rather than a bare transferPairId check: a one-sided
		// transfer has no category (a transfer is not spending) and no pair (there
		// is no second leg), so it matches "undecided" exactly. It survived only
		// because the loop below skips reviewState 'confirmed', which is a state
		// this query has no business depending on. A transfer is never a candidate
		// for categorisation, and now the query says so.
		.where(and(isNull(transaction.categoryId), notOwnTransfer()))
		.for('update');
	// Read proposals after claiming the undecided rows. The global lock excludes
	// another pairing pass, and waiting for ordinary row editors means their
	// committed state is visible before categorisation. Reading in the reverse
	// order would leave a commit window where a proposal can be missed.
	const proposedRows = await handle
		.select({ outId: transferPair.outTransactionId, inId: transferPair.inTransactionId })
		.from(transferPair)
		.where(eq(transferPair.state, 'proposed'));
	const proposedLegs = new Set(proposedRows.flatMap((p) => [p.outId, p.inId]));
	for (const t of undecided) {
		if (t.reviewState === 'confirmed') continue;
		if (proposedLegs.has(t.id)) continue; // waiting on the transfer decision
		const decision = decideWithRules(
			{
				counterparty: t.counterparty,
				counterpartyAccount: t.counterpartyAccount,
				variableSymbol: t.variableSymbol,
				description: t.description,
				amountMinor: t.amountMinor,
				currency: t.currency
			},
			rules,
			threshold
		);
		if (decision.kind === 'auto') {
			await handle
				.update(transaction)
				.set({
					categoryId: decision.categoryId,
					suggestedCategoryId: null,
					reviewState: 'auto',
					reviewReason: null
				})
				.where(eq(transaction.id, t.id));
		} else if (
			t.reviewState !== 'needs_review' ||
			t.reviewReason !== decision.reason ||
			t.suggestedCategoryId !== decision.categoryId
		) {
			await handle
				.update(transaction)
				.set({
					reviewState: 'needs_review',
					reviewReason: decision.reason,
					suggestedCategoryId: decision.categoryId
				})
				.where(eq(transaction.id, t.id));
		}
		// Tags are additive: every matching rule contributes, no conflict possible.
		if (decision.tagIds.length > 0) await addTagsToTransaction(t.id, decision.tagIds, handle);
	}

	return paired;
}
