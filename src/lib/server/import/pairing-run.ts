// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Pairing transfers and categorising, as one pass over a bounded window.
 *
 * Separate from `ingest.ts`: `ingestFile` turns a file into rows, this turns
 * rows that already exist into pairs and categories, and several callers
 * outside importing (rules, transaction edits, transfer decisions) want only
 * this half.
 *
 * It runs after each file so cross-file pairs appear as soon as the second leg
 * arrives. Only auto pairs — the ones on hard evidence — are excluded from the
 * figures immediately; review proposals stay in income and spending until the
 * household confirms them.
 */
import { uuidv7 } from 'uuidv7';
import { and, asc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm';
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
 * compared the entire unpaired ledger — proposePairs is a nested loop over it,
 * and the set only grows. Anchoring to the changed rows instead of "today"
 * bounds the work without caring how old they are, and lets historical
 * statements pair at all.
 */
/**
 * How far apart an asserted transfer and its real second leg may sit.
 *
 * The same three days tier 3 allows, for the same reason: a transfer booked on
 * one bank's Friday can land on the other's Monday. Wider would start adopting
 * a different payment of the same size.
 */
const ADOPTION_DAYS = 3;

/**
 * Give each hand-asserted one-sided transfer the real leg it was waiting for.
 *
 * Returns the ids adopted, so the caller can keep them out of the general
 * matcher. Both rows come out as a genuine pair in state `auto`: the household
 * named the account and the ledger now shows the movement, which is the same
 * standard of evidence tier 1 pairs on.
 */
async function adoptLateLegs(
	handle: Queryable,
	candidates: {
		id: string;
		accountId: string;
		bookedOn: string;
		amountMinor: bigint;
		currency: string;
	}[]
): Promise<Set<string>> {
	const adopted = new Set<string>();
	if (candidates.length === 0) return adopted;

	// The assertions still waiting: a named counterpart account, no real pair.
	const asserted = await handle
		.select()
		.from(transaction)
		.where(and(isNotNull(transaction.transferToAccountId), isNull(transaction.transferPairId)))
		.for('update');
	if (asserted.length === 0) return adopted;

	const claimed = new Set<string>();
	for (const one of asserted) {
		const match = candidates
			.filter(
				(late) =>
					!adopted.has(late.id) &&
					!claimed.has(late.id) &&
					// In the very account the assertion named, and not the one the
					// asserted row itself sits in.
					late.accountId === one.transferToAccountId &&
					late.accountId !== one.accountId &&
					late.currency === one.currency &&
					// Opposite and equal: the two halves of one movement.
					late.amountMinor === -one.amountMinor &&
					Math.abs(daysApart(late.bookedOn, one.bookedOn)) <= ADOPTION_DAYS
			)
			// Closest in time wins, as the general matcher also does.
			.sort(
				(a, b) =>
					Math.abs(daysApart(a.bookedOn, one.bookedOn)) -
						Math.abs(daysApart(b.bookedOn, one.bookedOn)) || (a.id < b.id ? -1 : 1)
			)[0];
		if (!match) continue;

		claimed.add(match.id);
		const pairId = uuidv7();
		const outId = one.amountMinor < 0n ? one.id : match.id;
		const inId = one.amountMinor < 0n ? match.id : one.id;
		await handle
			.insert(transferPair)
			.values({ id: pairId, outTransactionId: outId, inTransactionId: inId, state: 'auto' });
		for (const id of [outId, inId]) {
			await handle
				.update(transaction)
				.set({
					transferPairId: pairId,
					// The assertion has been superseded by the movement itself, so the
					// hand-written marker comes off: leaving it would show the row as
					// both asserted and paired, and `clearOneSidedTransfer` would then
					// offer to undo something that is now evidenced.
					transferToAccountId: null,
					reviewState: 'auto',
					reviewReason: null,
					categoryId: null
				})
				.where(eq(transaction.id, id));
		}
		adopted.add(match.id);
	}
	return adopted;
}

/** Whole days between two ISO days, signed. */
function daysApart(a: string, b: string): number {
	return (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

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

	// A leg that arrives AFTER the household asserted the other half by hand.
	//
	// Marking a one-sided transfer says "this went to Savings" while Savings'
	// own statement is not imported yet. When it finally is, the real second leg
	// turns up as an ordinary undecided row — and because the asserted side is
	// already out of the figures, the late one lands in them alone and the
	// transfer is counted half in, half out. The assertion NAMES the account, so
	// a leg sitting in exactly that account, opposite in sign and equal in
	// amount inside the window, is the half it was promised.
	//
	// Done before `proposePairs` and its legs removed from the candidates: a row
	// adopted here must not also be offered to the general matcher.
	const adopted = await adoptLateLegs(handle, candidates);
	const remaining = candidates.filter((t) => !adopted.has(t.id));

	const proposals = proposePairs(
		remaining.map((t): PairableTx => ({
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

	let paired = adopted.size;
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
	// Re-read the proposals rather than reuse the snapshot taken above: a leg
	// proposed in this very pass, categorised against a stale snapshot, could
	// flip to reviewState 'auto' and vanish from /import while its
	// transferPairId stays null, double-counting it as both income and spending.
	const undecided = await handle
		.select()
		.from(transaction)
		// `notOwnTransfer()` rather than a bare transferPairId check: a one-sided
		// transfer has no category and no pair, so it matches "undecided" exactly
		// without depending on reviewState.
		.where(and(isNull(transaction.categoryId), notOwnTransfer()))
		.for('update');
	// Read proposals after claiming the undecided rows, so their committed
	// state is visible before categorisation; the reverse order would leave a
	// commit window where a proposal can be missed.
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
