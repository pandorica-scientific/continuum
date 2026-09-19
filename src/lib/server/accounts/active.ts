// SPDX-License-Identifier: AGPL-3.0-or-later
import { isNull, type SQL } from 'drizzle-orm';
import { account } from '$lib/server/db/schema';

/**
 * Accounts still in use — everything except the ones closed or archived.
 *
 * Defined once and imported, for the same reason `notOwnTransfer` is: the
 * question "which accounts does this household have" is asked from the
 * Accounts screen, the import destination picker, the transfer target picker,
 * the transactions filter, the statements ribbon and the API, and a site that
 * forgot the condition would keep offering a closed account to file against.
 *
 * Deliberately NOT applied where an account is joined to NAME something that
 * already happened: the register still labels a closed account's old rows with
 * it, and cash-flow history still counts them. Archiving answers "what do I
 * have now", never "what did I spend".
 */
export function activeAccount(): SQL {
	return isNull(account.archivedAt) as SQL;
}
