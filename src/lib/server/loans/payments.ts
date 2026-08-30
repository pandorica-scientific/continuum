// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Which of a page's transactions are already recorded as a loan payment, and
 * how each of those divides.
 *
 * A read rather than a write, so it lives beside `mutations.ts` instead of in
 * it. One query for the whole page the way the register already reads its
 * splits, tags and receipts: it lists up to fifty rows at a time, and asking
 * per row would be fifty round trips to decide whether to draw a chip.
 *
 * The halves are here rather than left to the row itself because the register's
 * footer is summed from them in SQL: a claimed instalment counts as its interest
 * under one group and its principal under another, so a row showing one whole
 * debit under a footer holding half of it had nothing on screen to explain the
 * difference. Same claim, same arithmetic, same clamp.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { LOAN_PRINCIPAL_CATEGORY } from '$lib/categories';
import { PAYMENT_KINDS } from '$lib/loans';
import { splitPaymentLine } from '$lib/loans/payment-split';
import { db, type Queryable } from '$lib/server/db';
import { category, loan, loanEvent, transaction } from '$lib/server/db/schema';

/** The two lines one claimed instalment becomes, in the transaction's currency. */
export interface LoanPaymentHalves {
	interestMinor: bigint;
	principalMinor: bigint;
	/** What the principal's category is called — a household may rename it. */
	principalLabel: string;
}

/** The loan a transaction was recorded against, as the row names it. */
export interface LoanPaymentLink {
	loanId: string;
	loanName: string;
	/**
	 * Null when the record cannot divide this one: no interest on it, or the
	 * category the principal is filed under has been deleted. Both are the same
	 * condition the effective-line relation tests, so a row shows two lines
	 * exactly when the totals behind it were summed from two.
	 */
	halves: LoanPaymentHalves | null;
}

export async function loanPaymentByTransaction(
	transactionIds: string[],
	handle: Queryable = db
): Promise<Map<string, LoanPaymentLink>> {
	const byTransaction = new Map<string, LoanPaymentLink>();
	if (transactionIds.length === 0) return byTransaction;

	// The principal's category as the household holds it: its absence is what
	// stops the register splitting at all, and its name is what the second line
	// is labelled with. One row, read once for the page.
	const [principal] = await handle
		.select({ name: category.name })
		.from(category)
		.where(eq(category.id, LOAN_PRINCIPAL_CATEGORY));

	const rows = await handle
		.select({
			transactionId: loanEvent.transactionId,
			eventAmountMinor: loanEvent.amountMinor,
			interestMinor: loanEvent.interestMinor,
			loanId: loan.id,
			loanName: loan.name,
			// The line as every other consumer counts it, which is what the halves
			// have to add back up to.
			amountMinor: transaction.amountMinor,
			feeMinor: transaction.feeMinor
		})
		.from(loanEvent)
		.innerJoin(loan, eq(loanEvent.loanId, loan.id))
		.innerJoin(transaction, eq(loanEvent.transactionId, transaction.id))
		.where(
			and(inArray(loanEvent.transactionId, transactionIds), inArray(loanEvent.kind, PAYMENT_KINDS))
		)
		.orderBy(loanEvent.happenedOn, loanEvent.id);

	for (const row of rows) {
		// Oldest claim wins, which is the rule the cash-flow split already applies
		// to a transaction two events reference. Recording refuses the second one,
		// so this only arises for history written before it did — and the row must
		// still name one loan rather than whichever came back last.
		if (row.transactionId === null || byTransaction.has(row.transactionId)) continue;
		const net = row.amountMinor - (row.feeMinor ?? 0n);
		const split =
			principal && row.interestMinor !== null
				? splitPaymentLine(net, {
						amountMinor: row.eventAmountMinor,
						interestMinor: row.interestMinor
					})
				: null;
		byTransaction.set(row.transactionId, {
			loanId: row.loanId,
			loanName: row.loanName,
			// A half that came to nothing is not a line, and the relation drops it,
			// so a payment that was all principal or all interest is left saying it
			// is one movement rather than being shown as two with a zero.
			halves:
				split && split.interestMinor !== 0n && split.principalMinor !== 0n
					? { ...split, principalLabel: principal.name }
					: null
		});
	}
	return byTransaction;
}
