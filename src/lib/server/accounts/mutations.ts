// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Correcting an account after it exists.
 *
 * Until now one could be created and never changed: a mistyped name, the wrong
 * bank, "current" where "savings" was meant, all permanent. And every account
 * was joint, because `addAccount` never set an owner and the row said "joint"
 * only because there was nothing else it could say.
 */

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
