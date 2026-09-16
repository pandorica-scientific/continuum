// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Which account a statement belongs to.
 *
 * Identity comes from the account NUMBER or the issuer only when the file
 * actually named one — never from `statement.bank`, which since format-first
 * routing holds a FORMAT name for every reading no adapter produced.
 * Consulting it there can refuse a correct account, collapse two unrelated
 * banks into one, split one real account into two, or mint an account named
 * `tabular EUR`.
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
 * A statement is imported INTO an account whose bank and currency the user
 * stated; that metadata is authoritative, and what the document appears to
 * say is corroboration only.
 */
export async function resolveAccount(
	statement: ParsedStatement,
	explicitAccountId: string | undefined,
	handle: Queryable
): Promise<Resolution> {
	if (explicitAccountId) {
		// Same identity -> account lock order as automatic resolution, so an
		// automatic upload can't race an explicit first assignment.
		if (statement.accountNumber) {
			const statementIdentity = canonicalAccountIdentity(statement.accountNumber);
			await handle.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${`continuum:statement-account:${statement.currency}:${statementIdentity}`}, 0))`
			);
		}
		// Lock the selected row's stable id, then read it, so every balance
		// decision for that account sees the latest committed date.
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
		// Only when the FILE named its issuer — a generic reading reports the
		// format, and comparing that against the account would wrongly refuse it.
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

	// The first two statements for an as-yet unknown account could otherwise
	// both observe an empty account table and mint separate rows; this
	// transaction-scoped lock serialises on the canonical statement identity.
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
		// The account number IS the identity; requiring the bank to match too
		// would split one real account in two if read by two different readers.
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
		// issuer has to be real evidence rather than a file-format name.
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
	// `other` is the honest value: a format name is not a bank.
	const id = uuidv7();
	const label = statement.issuer ? (BANK_LABEL[statement.issuer] ?? statement.issuer) : 'Bank';
	// An adapter that names an issuer the seed does not cover puts it in the
	// picker. Only a real issuer — `statement.bank` is a format name for most readings.
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
 * Importing what resolved and asking about the rest sounds friendlier, but a
 * corrected re-upload is then refused as a duplicate by the file's content
 * hash, stranding the unresolved statements. A file is all or nothing.
 */
