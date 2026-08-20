// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { and, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { transaction } from '$lib/server/db/schema';

/**
 * Movements between the household's own accounts, which are never income and
 * never spending.
 *
 * There are two kinds and every total has to exclude both: a matched pair,
 * proved by finding the same movement on two statements, and a one-sided
 * transfer, asserted by a person because the far account is not imported.
 *
 * Defined once and imported everywhere for a reason. The exclusion is applied
 * at seven separate call sites — cash flow twice, the register, the briefing,
 * the overview, the import screen — and a site that checked only one of the two
 * would quietly count a transfer as spending. That is precisely the class of
 * error this release is fixing elsewhere, so the condition is not restated.
 */
export function isOwnTransfer(): SQL {
	return or(
		isNotNull(transaction.transferPairId),
		isNotNull(transaction.transferToAccountId)
	) as SQL;
}

/** The complement: money that genuinely left or entered the household. */
export function notOwnTransfer(): SQL {
	return and(isNull(transaction.transferPairId), isNull(transaction.transferToAccountId)) as SQL;
}
