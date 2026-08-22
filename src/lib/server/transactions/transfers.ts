// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { and, isNull, type SQL } from 'drizzle-orm';
import { transaction } from '$lib/server/db/schema';

/**
 * Money that genuinely left or entered the household — everything except a
 * movement between the household's own accounts.
 *
 * There are two kinds of own movement and this has to exclude both: a matched
 * pair, proved by finding the same movement on two statements, and a one-sided
 * transfer, asserted by a person because the far account is not imported.
 *
 * Defined once and imported everywhere for a reason. The exclusion is applied
 * at seven separate call sites — cash flow twice, the register, the briefing,
 * the overview, the import screen — and a site that checked only one of the two
 * would quietly count a transfer as spending. That is precisely the class of
 * error this release is fixing elsewhere, so the condition is not restated.
 */
export function notOwnTransfer(): SQL {
	return and(isNull(transaction.transferPairId), isNull(transaction.transferToAccountId)) as SQL;
}
