// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which account a statement belongs to.
 *
 * Its own module because it is its own decision a costly one to get wrong:
 * identity comes from the account NUMBER from the issuer only when the file
 * actually named one. It is never taken from `statement.bank`, which since
 * format-first routing holds a FORMAT name for every reading no adapter
 * produced. Reading it there caused all four of a correct account being refused,
 * two unrelated banks collapsing into one, one real account becoming two and
 * importing everything twice an account minted and named `tabular EUR`.
 *
 * Lifted out of `ingest.ts`, which carried this, the statement writer and the
 * pairing pass in twelve hundred lines behind five exports.
 */
import { uuidv7 } from 'uuidv7';
import { eq, sql } from 'drizzle-orm';
import { account, bank } from '$lib/server/db/schema';
import type { Queryable } from '$lib/server/db';
import type { ParsedStatement } from './types';
import { accountKeysMatch, canonicalAccountIdentity, normaliseAccountKey } from './pairing';

interface LegacyRevolutIdentity {
	bookedOn: string;
	amountMinor: bigint;
	currency: string;
	bankRef?: string | null;
	counterpartyAccount?: string | null;
	counterparty?: string | null;
	description?: string | null;
	balanceAfterMinor?: bigint | null;
	variableSymbol?: string | null;
	constantSymbol?: string | null;
	specificSymbol?: string | null;
	originalAmountMinor?: bigint | null;
	originalCurrency?: string | null;
}

export function legacyRevolutKey(row: LegacyRevolutIdentity): string {
	return JSON.stringify([
		row.bookedOn,
		row.amountMinor.toString(),
		row.currency,
		row.bankRef ?? '',
		row.counterpartyAccount ?? '',
		row.counterparty ?? '',
		row.description ?? '',
		row.balanceAfterMinor?.toString() ?? '',
		row.variableSymbol ?? '',
		row.constantSymbol ?? '',
		row.specificSymbol ?? '',
		row.originalAmountMinor?.toString() ?? '',
		row.originalCurrency ?? ''
	]);
}

export const BANK_LABEL: Record<string, string> = {
	fio: 'Fio',
	revolut: 'Revolut',
	mbank: 'mBank',
	rb: 'Raiffeisenbank',
	cs: 'Česká spořitelna',
	// ABO names no issuer, so the format is the honest label. The user can
	// rename the account; inventing a bank would be a guess stored as fact.
	abo: 'Bank (ABO/GPC)'
};

export type Resolution =
	{ kind: 'ok'; account: typeof account.$inferSelect } | { kind: 'ambiguous'; reason: string };

/**
 * Match the statement to an account. When the statement carries no account
 * number (Revolut) and more than one candidate exists, refuse and ask —
 * silently creating a fresh account would fragment the ledger and defeat
 * dedup, since the unique index is scoped per account.
 *
 * Identity comes from the account NUMBER from the issuer only when the
 * file actually named one. It never comes from `statement.bank`, which since
 * format-first routing holds a format name for every reading an adapter did
 * not produce. Consulting it there caused all four of:
 *
 *   - a correct account choice refused, because `cs` is not `tabular`;
 *   - two unrelated banks read generically in one currency collapsing into a
 *     single account;
 *   - one real account read by an adapter and from a CAMT export becoming two
 *     accounts, importing every movement twice, because dedup is scoped per
 *     account;
 *   - an account minted and named, literally, `tabular EUR`.
 *
 * The governing rule is recorded elsewhere and is the same one: a statement is
 * imported INTO an account whose bank and currency the user stated that
 * metadata is authoritative. What the document appears to say is corroboration.
 */
export async function resolveAccount(
	statement: ParsedStatement,
	explicitAccountId: string | undefined,
	handle: Queryable
): Promise<Resolution> {
	if (explicitAccountId) {
		// Use the same identity -> account lock order as automatic resolution.
		// This prevents an automatic upload racing an explicit first assignment
		// from observing the account before its statement identity is learned.
		if (statement.accountNumber) {
			const statementIdentity = canonicalAccountIdentity(statement.accountNumber);
			await handle.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${`continuum:statement-account:${statement.currency}:${statementIdentity}`}, 0))`
			);
		}
		// Explicit imports can carry aliases that produce different statement
		// identity keys. Lock the selected row's stable id, then read it, so every
		// balance decision for that account sees the latest committed date.
		await handle.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`continuum:account:${explicitAccountId}`}, 0))`
		);
		const [chosen] = await handle.select().from(account).where(eq(account.id, explicitAccountId));
		if (!chosen) return { kind: 'ambiguous', reason: 'The selected account no longer exists.' };
		if (chosen.currency !== statement.currency) {
			return {
				kind: 'ambiguous',
				reason: `The selected account uses ${chosen.currency}, but this statement uses ${statement.currency}. Choose an account with the statement currency.`
			};
		}
		// Only when the FILE named its issuer. A generic reading reports the
		// format it was read as comparing that against the account told the
		// user their own account was wrong — for a file they had just pointed at
		// it deliberately.
		if (statement.issuer && chosen.bank !== statement.issuer) {
			return {
				kind: 'ambiguous',
				reason: `The selected account belongs to ${chosen.bank}, but this statement was read as a ${statement.issuer} statement.`
			};
		}
		if (
			statement.accountNumber &&
			chosen.numbers.length > 0 &&
			!chosen.numbers.some((number) => accountKeysMatch(number, statement.accountNumber!))
		) {
			return {
				kind: 'ambiguous',
				reason: `The statement account number does not match the selected account.`
			};
		}
		return { kind: 'ok', account: chosen };
	}

	// The first two statements for an as-yet unknown account can otherwise both
	// observe an empty account table and mint separate UUID rows. PostgreSQL's
	// transaction-scoped lock serialises just that canonical statement identity;
	// equivalent Czech local/IBAN forms deliberately share a key.
	const statementIdentity = statement.accountNumber
		? canonicalAccountIdentity(statement.accountNumber)
		: '(number-not-printed)';
	await handle.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`continuum:statement-account:${statement.currency}:${statementIdentity}`}, 0))`
	);
	const accounts = await handle.select().from(account);
	let resolved: typeof account.$inferSelect | undefined;

	if (statement.accountNumber) {
		const key = normaliseAccountKey(statement.accountNumber);
		// The account number IS the identity. Requiring the bank to match as well
		// split one real account in two as soon as the same statement was read by
		// two different readers dedup is scoped per account, so every
		// movement then imported a second time.
		const byNumber = accounts.filter(
			(a) =>
				(!statement.issuer || a.bank === statement.issuer) &&
				a.currency === statement.currency &&
				a.numbers.some((number) => accountKeysMatch(normaliseAccountKey(number), key))
		);
		if (byNumber.length === 1) resolved = byNumber[0];
		if (byNumber.length > 1) {
			return {
				kind: 'ambiguous',
				reason:
					'Several accounts share this bank, currency account number. Choose the intended account and upload again.'
			};
		}
	} else {
		// Nothing identifies this statement but its bank and currency, so the
		// issuer has to be evidence rather than the name of a file format. Two
		// unrelated banks whose statements were both read generically in EUR are
		// not the same account matching on `tabular` + EUR said they were.
		if (!statement.issuer) {
			return {
				kind: 'ambiguous',
				reason:
					'This statement prints no account number the file does not say which bank issued it — pick the account it belongs to.'
			};
		}
		const byBank = accounts.filter(
			(a) => a.bank === statement.issuer && a.currency === statement.currency
		);
		if (byBank.length === 1) resolved = byBank[0];
		if (byBank.length > 1) {
			return {
				kind: 'ambiguous',
				reason: `Several ${BANK_LABEL[statement.issuer] ?? statement.issuer} ${statement.currency} accounts exist and this statement does not say which it belongs to — pick the account and upload again.`
			};
		}
	}

	if (resolved) {
		await handle.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`continuum:account:${resolved.id}`}, 0))`
		);
		const [fresh] = await handle.select().from(account).where(eq(account.id, resolved.id));
		if (!fresh) return { kind: 'ambiguous', reason: 'The matched account no longer exists.' };
		return { kind: 'ok', account: fresh };
	}

	// First statement from this account: create it.
	//
	// Reaching here without an issuer means the statement printed an account
	// number — the branch above refuses to guess when it printed neither — so
	// the row has a real identity even though the institution is unknown.
	// `other` is what the column's own comment reserves for that it is the
	// honest value: a format name is not a bank storing one produced an
	// account called `tabular EUR` and published it through /api/v1.
	const id = uuidv7();
	const label = statement.issuer ? (BANK_LABEL[statement.issuer] ?? statement.issuer) : 'Bank';
	// An adapter that names an issuer the seed does not cover puts it in the
	// picker, so the next account can be filed under a bank the household demonstrably
	// uses. Only a real issuer — `statement.bank` is a format name for most
	// readings a format is not a bank.
	if (statement.issuer) {
		await handle
			.insert(bank)
			.values({ key: statement.issuer, label, emoji: '🏦' })
			.onConflictDoNothing();
	}
	// Suffix from the account number itself, not the bank code after the slash.
	const numberPart = statement.accountNumber?.split('/')[0].replace(/\D/g, '') ?? '';
	const suffix = numberPart ? ` ·${numberPart.slice(-4)}` : '';
	const [created] = await handle
		.insert(account)
		.values({
			id,
			name: `${label} ${statement.currency}${suffix}`,
			bank: statement.issuer ?? 'other',
			currency: statement.currency,
			numbers: statement.accountNumber ? [statement.accountNumber] : []
		})
		.returning();
	return { kind: 'ok', account: created };
}

/**
 * Thrown to roll the file's transaction back when a statement cannot be
 * assigned to an account.
 *
 * Importing what resolved and asking about the rest sounds friendlier, but it
 * records the file's content hash — and the corrected re-upload is then refused
 * as a duplicate, stranding the unresolved statements permanently. Until a
 * statement can be re-imported on its own, a file is all or nothing.
 */
