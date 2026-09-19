// SPDX-License-Identifier: AGPL-3.0-or-later
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { transaction } from '$lib/server/db/schema';

/**
 * Money that genuinely left or entered the household — everything except a
 * movement between the household's own accounts.
 *
 * There are three kinds of own movement and this has to exclude all of them: a
 * matched pair, proved by finding the same movement on two statements; a
 * one-sided transfer to a named account, asserted by a person because the far
 * account is not imported; and one to an account the household does not keep at
 * all — closed, or at a bank never added here — which has no row to name.
 *
 * Defined once and imported everywhere for a reason. The exclusion is applied
 * at seven separate call sites — cash flow twice, the register, the briefing,
 * the overview, the import screen — and a site that checked only one of the two
 * would quietly count a transfer as spending. That is precisely the class of
 * error this release is fixing elsewhere, so the condition is not restated.
 */
export function notOwnTransfer(): SQL {
	return and(
		isNull(transaction.transferPairId),
		isNull(transaction.transferToAccountId),
		eq(transaction.transferToUntracked, false)
	) as SQL;
}
