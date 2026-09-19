// SPDX-License-Identifier: AGPL-3.0-or-later
/** Correcting an account after it exists (name, bank, kind, owner, currency). */

import { count, eq } from 'drizzle-orm';
import { db, type Db } from '$lib/server/db';
import { account, bank, person, transaction } from '$lib/server/db/schema';
import { asEnumValue } from '$lib/enums';

export type AccountMutationResult =
	{ ok: true } | { ok: false; status: 400 | 404 | 409; message: string };

export interface UpdateAccountInput {
	name: string;
	emoji: string;
	bank: string;
	kind: string;
	/** Empty means joint, which is a real answer rather than an absence. */
	ownerPersonId: string | null;
	numbers: string[];
	/** Only honoured while the account holds nothing. See below. */
	currency: string | null;
}

export async function updateAccount(
	id: string,
	input: UpdateAccountInput,
	handle: Db = db
): Promise<AccountMutationResult> {
	const name = input.name.trim();
	if (!name) return { ok: false, status: 400, message: 'The account needs a name.' };

	return handle.transaction(async (tx) => {
		const [existing] = await tx.select().from(account).where(eq(account.id, id)).for('update');
		if (!existing) return { ok: false as const, status: 404, message: 'Account not found.' };

		// account.bank is deliberately not a foreign key — see the schema — but the
		// picker only offers rows from `bank`, and a key it does not know shows a
		// default emoji and matches no statement. Checked here rather than left to
		// go wrong quietly later.
		const [chosenBank] = await tx.select().from(bank).where(eq(bank.key, input.bank));
		if (!chosenBank) {
			return { ok: false as const, status: 400, message: 'That bank is not on the list.' };
		}

		if (input.ownerPersonId) {
			const [owner] = await tx.select().from(person).where(eq(person.id, input.ownerPersonId));
			if (!owner) return { ok: false as const, status: 400, message: 'That person is not here.' };
		}

		/**
		 * Currency is locked once anything is filed against the account.
		 *
		 * Every stored amount is minor units OF THIS CURRENCY, and the account is
		 * the authority for what an imported statement is denominated in. Changing
		 * it later would not convert anything — it would silently reinterpret every
		 * figure already recorded, turning 1 000 CZK into 1 000 EUR.
		 *
		 * While the account is empty there is nothing to reinterpret, so it is a
		 * correction like any other.
		 */
		let currency = existing.currency;
		if (input.currency && input.currency !== existing.currency) {
			const [filed] = await tx
				.select({ value: count() })
				.from(transaction)
				.where(eq(transaction.accountId, id));
			const held = filed?.value ?? 0;
			if (held > 0) {
				return {
					ok: false as const,
					status: 409,
					message:
						`This account already holds ${held} ${held === 1 ? 'transaction' : 'transactions'} ` +
						`recorded in ${existing.currency}. Changing its currency would reinterpret every one ` +
						`of them rather than convert them, so it stays as it is.`
				};
			}
			if (!/^[A-Z]{3}$/.test(input.currency)) {
				return {
					ok: false as const,
					status: 400,
					message: 'Currency must be a three-letter code.'
				};
			}
			currency = input.currency;
		}

		await tx
			.update(account)
			.set({
				name,
				// An empty emoji falls back to the bank's, which is what the row
				// already does when it displays one.
				emoji: input.emoji.trim() || chosenBank.emoji,
				bank: input.bank,
				kind: asEnumValue('account.kind', input.kind, existing.kind),
				ownerPersonId: input.ownerPersonId,
				numbers: input.numbers,
				currency
			})
			.where(eq(account.id, id));

		return { ok: true as const };
	});
}

/** Account numbers as a person types them: comma, semicolon or space separated. */
export function parseAccountNumbers(raw: string): string[] {
	return raw
		.split(/[,;\s]+/)
		.map((entry) => entry.trim())
		.filter(Boolean);
}

/**
 * Close an account without losing what it held.
 *
 * Archiving, not deleting, because `transaction.account_id` cascades: removing
 * an account that carried history would take every row with it, and money
 * spent from an account you have since closed was still spent. The rows stay
 * in the ledger and in cash-flow history; the account leaves the places that
 * ask what you have NOW — the pickers, net worth, the cash donut.
 */
export async function archiveAccount(id: string, handle: Db = db): Promise<AccountMutationResult> {
	const [row] = await handle.select().from(account).where(eq(account.id, id));
	if (!row) return { ok: false, status: 404, message: 'That account is not there.' };
	if (row.archivedAt) return { ok: false, status: 409, message: 'That account is already closed.' };
	await handle.update(account).set({ archivedAt: new Date() }).where(eq(account.id, id));
	return { ok: true };
}

/** Put it back in use. Its history never went anywhere. */
export async function unarchiveAccount(
	id: string,
	handle: Db = db
): Promise<AccountMutationResult> {
	const [row] = await handle.select().from(account).where(eq(account.id, id));
	if (!row) return { ok: false, status: 404, message: 'That account is not there.' };
	await handle.update(account).set({ archivedAt: null }).where(eq(account.id, id));
	return { ok: true };
}

/**
 * Delete an account outright — only one that never held anything.
 *
 * For the account added by mistake, where there is nothing to preserve. The
 * moment it has carried a single transaction this refuses and says to close it
 * instead: the foreign key cascades, so allowing it here would quietly delete
 * a statement's worth of history to tidy up a list.
 *
 * Counted inside the transaction that does the delete, so a row imported
 * between the check and the delete cannot slip through.
 */
export async function deleteAccount(id: string, handle: Db = db): Promise<AccountMutationResult> {
	return handle.transaction(async (tx) => {
		const [row] = await tx.select().from(account).where(eq(account.id, id)).for('update');
		if (!row) return { ok: false, status: 404, message: 'That account is not there.' };

		const [held] = await tx
			.select({ n: count() })
			.from(transaction)
			.where(eq(transaction.accountId, id));
		if ((held?.n ?? 0) > 0) {
			return {
				ok: false,
				status: 409,
				message: `${row.name} holds ${held.n} transaction${held.n === 1 ? '' : 's'}. Close it instead — deleting would take them with it.`
			};
		}

		await tx.delete(account).where(eq(account.id, id));
		return { ok: true };
	});
}
