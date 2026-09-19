// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Where a one-sided transfer probably went, from where the last ones went.
 *
 * "Moved to which account?" arrived blank every time, including for the ninth
 * identical standing payment to the same savings account. The answer is
 * already in the ledger — every row somebody marked this way recorded its
 * destination — so nothing new is stored: the past decisions ARE the memory.
 *
 * Two strengths of evidence, and they are not the same claim:
 *
 *  - the same destination account number was answered before. That is this
 *    payee, so the answer carries over.
 *  - only the source account matches. That is a habit, not an identification,
 *    so it is offered as a default and never as a certainty.
 */

/** The destination a past decision named. `untracked` means "closed or not tracked". */
export interface PastDecision {
	/** The account the money left. */
	accountId: string;
	/** The destination account number as the statement printed it, if any. */
	counterpartyAccount: string | null;
	/** The account chosen, or null when the answer was "untracked". */
	toAccountId: string | null;
	untracked: boolean;
	/** Ledger date, newest wins among equals. */
	bookedOn: string;
}

export interface RowToAnswer {
	accountId: string;
	counterpartyAccount?: string | null;
}

export interface Recalled {
	/** The account to preselect, or null when the remembered answer was "untracked". */
	toAccountId: string | null;
	untracked: boolean;
	/** True only when the same destination account number was answered before. */
	certain: boolean;
}

const UNTRACKED_TALLY_KEY = 'untracked:';

/**
 * The most-repeated past answer, newest breaking a tie.
 *
 * Most-repeated rather than most-recent: one mistaken answer among eight
 * correct ones should not become the default for the ninth.
 */
function winner(decisions: PastDecision[]): Recalled | null {
	const tally = new Map<string, { count: number; latest: string; decision: PastDecision }>();
	for (const decision of decisions) {
		// Prefixed so an account id can never collide with the untracked answer.
		const key = decision.untracked ? UNTRACKED_TALLY_KEY : `account:${decision.toAccountId ?? ''}`;
		if (key === 'account:') continue;
		const seen = tally.get(key);
		if (!seen) {
			tally.set(key, { count: 1, latest: decision.bookedOn, decision });
			continue;
		}
		seen.count += 1;
		if (decision.bookedOn > seen.latest) {
			seen.latest = decision.bookedOn;
			seen.decision = decision;
		}
	}
	const ranked = [...tally.values()].sort(
		(a, b) => b.count - a.count || (a.latest < b.latest ? 1 : -1)
	);
	const top = ranked[0];
	if (!top) return null;
	return {
		toAccountId: top.decision.untracked ? null : top.decision.toAccountId,
		untracked: top.decision.untracked,
		certain: false
	};
}

/** How many agreeing past answers make a habit worth preselecting. */
const HABIT_MINIMUM = 2;

export function recallDestination(row: RowToAnswer, past: PastDecision[]): Recalled | null {
	const account = (row.counterpartyAccount ?? '').trim();
	if (account) {
		// The same destination number, whatever account it left from: this is
		// the payee, and the answer is the same answer.
		const sameCounterparty = past.filter((d) => (d.counterpartyAccount ?? '').trim() === account);
		const exact = winner(sameCounterparty);
		if (exact) return { ...exact, certain: true };
	}

	// Nothing identifies the payee, so all that is left is what this account
	// usually does — and a habit is held to a much higher bar than a match.
	const habitual = past.filter((d) => d.accountId === row.accountId);
	if (habitual.length < HABIT_MINIMUM) return null;
	// Unanimous or nothing. A split history ("sometimes savings, sometimes
	// Revolut") is not a habit, and preselecting the more frequent half of it
	// puts a wrong account in front of somebody on every single row.
	const answers = new Set(habitual.map((d) => (d.untracked ? 'untracked' : d.toAccountId)));
	if (answers.size !== 1) return null;
	const guess = winner(habitual);
	// "Closed or not tracked" is never guessed at. Every other answer can be
	// corroborated later — `adoptLateLegs` waits for exactly that — and this one
	// never can, so it is offered only when the destination number identifies it
	// above, never because of what this account tends to do.
	if (!guess || guess.untracked) return null;
	return guess;
}
