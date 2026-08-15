import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gte, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account, importFile, person, transaction, transferPair } from '$lib/server/db/schema';
import { convertMinorSync, loadRateTable } from '$lib/server/fx/table';
import { decideWithRules } from '$lib/rules/match';
import { autoThreshold, loadRules } from '$lib/server/rules';
import { addTagsToTransaction } from '$lib/server/tags';
import { saveUpload } from '$lib/server/files';
import { detectAndParse } from './detect';
import { FINGERPRINT_VERSION, fingerprintAll } from './fingerprint';
import { normaliseAccountKey, proposePairs, type PairableTx } from './pairing';
import type { ParsedStatement } from './types';

export interface IngestResult {
	filename: string;
	bank?: string;
	rowsRead: number;
	rowsAdded: number;
	rowsDuplicate: number;
	rowsPaired: number;
	/** set when the statement could not be assigned to an account — the user
	 * must pick one and re-upload with it */
	needsAccount?: boolean;
	error?: string;
}

const BANK_LABEL: Record<string, string> = {
	fio: 'Fio',
	revolut: 'Revolut',
	mbank: 'mBank',
	rb: 'Raiffeisenbank',
	cs: 'Česká spořitelna'
};

type Resolution =
	{ kind: 'ok'; account: typeof account.$inferSelect } | { kind: 'ambiguous'; reason: string };

/**
 * Match the statement to an account. When the statement carries no account
 * number (Revolut) and more than one candidate exists, refuse and ask —
 * silently creating a fresh account would fragment the ledger and defeat
 * dedup, since the unique index is scoped per account.
 */
async function resolveAccount(
	statement: ParsedStatement,
	explicitAccountId?: string
): Promise<Resolution> {
	const accounts = await db.select().from(account);

	if (explicitAccountId) {
		const chosen = accounts.find((a) => a.id === explicitAccountId);
		if (!chosen) return { kind: 'ambiguous', reason: 'The selected account no longer exists.' };
		return { kind: 'ok', account: chosen };
	}

	if (statement.accountNumber) {
		const key = normaliseAccountKey(statement.accountNumber);
		const byNumber = accounts.find((a) =>
			a.numbers.some((n) => normaliseAccountKey(n) === key || key.includes(normaliseAccountKey(n)))
		);
		if (byNumber) return { kind: 'ok', account: byNumber };
	} else {
		const byBank = accounts.filter(
			(a) => a.bank === statement.bank && a.currency === statement.currency
		);
		if (byBank.length === 1) return { kind: 'ok', account: byBank[0] };
		if (byBank.length > 1) {
			return {
				kind: 'ambiguous',
				reason: `Several ${BANK_LABEL[statement.bank] ?? statement.bank} ${statement.currency} accounts exist and this statement does not say which it belongs to — pick the account and upload again.`
			};
		}
	}

	// First statement from this account: create it.
	const id = randomUUID();
	const label = BANK_LABEL[statement.bank] ?? statement.bank;
	// Suffix from the account number itself, not the bank code after the slash.
	const numberPart = statement.accountNumber?.split('/')[0].replace(/\D/g, '') ?? '';
	const suffix = numberPart ? ` ·${numberPart.slice(-4)}` : '';
	const [created] = await db
		.insert(account)
		.values({
			id,
			name: `${label} ${statement.currency}${suffix}`,
			bank: statement.bank,
			currency: statement.currency,
			numbers: statement.accountNumber ? [statement.accountNumber] : []
		})
		.returning();
	return { kind: 'ok', account: created };
}

/** Ingest one uploaded statement file end to end. */
export async function ingestFile(
	filename: string,
	buffer: Uint8Array,
	explicitAccountId?: string
): Promise<IngestResult> {
	const contentHash = createHash('sha256').update(buffer).digest('hex');

	const existing = await db
		.select()
		.from(importFile)
		.where(eq(importFile.contentHash, contentHash));
	if (existing.length > 0) {
		return {
			filename,
			bank: existing[0].bank,
			rowsRead: existing[0].rowsRead,
			rowsAdded: 0,
			rowsDuplicate: existing[0].rowsRead,
			rowsPaired: 0,
			error: 'This exact file was already imported.'
		};
	}

	let statement: ParsedStatement;
	try {
		statement = await detectAndParse(buffer);
	} catch (err) {
		return {
			filename,
			rowsRead: 0,
			rowsAdded: 0,
			rowsDuplicate: 0,
			rowsPaired: 0,
			error: err instanceof Error ? err.message : String(err)
		};
	}

	// A parse that found nothing is a parser problem, not an import. Recording
	// it would store the content hash and make the correct re-import — after a
	// sniffing or adapter fix — look like a duplicate forever, and resolving an
	// account below would mint one for a bank the user may not even have.
	if (statement.rows.length === 0) {
		return {
			filename,
			bank: statement.bank,
			rowsRead: 0,
			rowsAdded: 0,
			rowsDuplicate: 0,
			rowsPaired: 0,
			error:
				'No transactions were found in this file, so nothing was imported. The file was not recorded — you can upload it again once the format is supported.'
		};
	}

	const resolution = await resolveAccount(statement, explicitAccountId);
	if (resolution.kind === 'ambiguous') {
		return {
			filename,
			bank: statement.bank,
			rowsRead: statement.rows.length,
			rowsAdded: 0,
			rowsDuplicate: 0,
			rowsPaired: 0,
			needsAccount: true,
			error: resolution.reason
		};
	}
	const acct = resolution.account;
	const fileId = randomUUID();

	// Keep the original bytes on the data volume: parser improvements re-parse
	// stored files instead of asking for years of statements again.
	let storedName: string | null;
	try {
		storedName = await saveUpload(new File([buffer as BlobPart], filename));
	} catch {
		storedName = null; // unexpected extension — the import still proceeds
	}

	const fingerprints = fingerprintAll(statement.rows);
	let added = 0;
	let duplicate = 0;
	// The import-file row must exist before transactions reference it.
	await db.insert(importFile).values({
		id: fileId,
		filename,
		bank: statement.bank,
		format: statement.format,
		accountId: acct.id,
		contentHash,
		storedName,
		rowsRead: statement.rows.length
	});

	for (let i = 0; i < statement.rows.length; i++) {
		const row = statement.rows[i];
		const inserted = await db
			.insert(transaction)
			.values({
				id: randomUUID(),
				accountId: acct.id,
				bookedAt: row.bookedAt,
				valueDate: row.valueDate,
				amount: row.amountMinor,
				feeMinor: row.feeMinor,
				currency: row.currency,
				balanceAfterMinor: row.balanceAfterMinor,
				originalAmountMinor: row.originalAmountMinor,
				originalCurrency: row.originalCurrency,
				counterparty: row.counterparty,
				counterpartyAccount: row.counterpartyAccount,
				variableSymbol: row.variableSymbol,
				constantSymbol: row.constantSymbol,
				specificSymbol: row.specificSymbol,
				description: row.description,
				bankRef: row.bankRef,
				dedupFingerprint: fingerprints[i],
				fingerprintVersion: FINGERPRINT_VERSION,
				importFileId: fileId
			})
			.onConflictDoNothing({ target: [transaction.accountId, transaction.dedupFingerprint] })
			.returning({ id: transaction.id });
		if (inserted.length > 0) added++;
		else duplicate++;
	}

	// Statement closing balance is authoritative when it is the newest we have.
	if (
		statement.closingBalanceMinor !== undefined &&
		statement.periodEnd &&
		(!acct.balanceAsOf || statement.periodEnd >= acct.balanceAsOf)
	) {
		await db
			.update(account)
			.set({ balanceMinor: statement.closingBalanceMinor, balanceAsOf: statement.periodEnd })
			.where(eq(account.id, acct.id));
	}

	const paired = await pairAndCategorise();

	await db
		.update(importFile)
		.set({ rowsAdded: added, rowsDuplicate: duplicate, rowsPaired: paired })
		.where(eq(importFile.id, fileId));

	return {
		filename,
		bank: statement.bank,
		rowsRead: statement.rows.length,
		rowsAdded: added,
		rowsDuplicate: duplicate,
		rowsPaired: paired
	};
}

/**
 * Pair transfers and categorise every not-yet-decided transaction. Runs after
 * each file so cross-file pairs appear as soon as the second leg arrives.
 *
 * Only auto pairs (hard evidence) are excluded from the figures immediately;
 * review proposals stay in income/spending until the user confirms them.
 */
export async function pairAndCategorise(): Promise<number> {
	const accounts = await db.select().from(account);
	const people = await db.select({ name: person.name }).from(person);
	const rates = await loadRateTable();

	// Candidate legs: recent, unpaired, and not already part of a pending
	// proposal (else every run would re-propose the same pairs).
	const horizon = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
	const pendingPairs = await db.select().from(transferPair);
	const legsInPairs = new Set(pendingPairs.flatMap((p) => [p.outTransactionId, p.inTransactionId]));
	const candidates = (
		await db
			.select()
			.from(transaction)
			.where(and(isNull(transaction.transferPairId), gte(transaction.bookedAt, horizon)))
			.orderBy(asc(transaction.bookedAt), asc(transaction.id))
	).filter((t) => !legsInPairs.has(t.id));

	const proposals = proposePairs(
		candidates.map((t): PairableTx => ({
			id: t.id,
			accountId: t.accountId,
			bookedAt: t.bookedAt,
			amountMinor: t.amount,
			currency: t.currency,
			counterparty: t.counterparty,
			counterpartyAccount: t.counterpartyAccount
		})),
		{
			accounts: accounts.map((a) => ({
				id: a.id,
				currency: a.currency,
				numberKeys: a.numbers.map(normaliseAccountKey)
			})),
			personNames: people.map((p) => p.name),
			convert: (amount, from, to, day) => convertMinorSync(rates, amount, from, to, day)
		}
	);

	let paired = 0;
	for (const proposal of proposals) {
		const pairId = randomUUID();
		if (proposal.confidence === 'auto') {
			await db.insert(transferPair).values({
				id: pairId,
				outTransactionId: proposal.outId,
				inTransactionId: proposal.inId,
				state: 'auto'
			});
			for (const id of [proposal.outId, proposal.inId]) {
				await db
					.update(transaction)
					.set({
						transferPairId: pairId,
						reviewState: 'auto',
						reviewReason: null,
						categoryId: null
					})
					.where(eq(transaction.id, id));
			}
			paired += 2;
		} else {
			// Held proposal: no transferPairId, so the legs stay in the figures
			// and in the review queue until confirmed.
			await db.insert(transferPair).values({
				id: pairId,
				outTransactionId: proposal.outId,
				inTransactionId: proposal.inId,
				state: 'proposed'
			});
			for (const id of [proposal.outId, proposal.inId]) {
				await db
					.update(transaction)
					.set({
						reviewState: 'needs_review',
						reviewReason: 'looks like a transfer between your own accounts'
					})
					.where(eq(transaction.id, id));
			}
		}
	}

	// Categorise whatever is new and not a transfer (held proposals included —
	// a categorisation would resolve them as "not a transfer").
	const [rules, threshold] = await Promise.all([loadRules(), autoThreshold()]);
	// Re-read the proposals rather than reuse the snapshot taken above: the loop
	// that just ran inserts proposals of its own, and a leg waiting on a
	// transfer decision must not be categorised out from under it. Against the
	// stale snapshot, a leg proposed in this very pass could match a rule, flip
	// to reviewState 'auto', and vanish from /import — which lists only
	// 'needs_review'. Its transferPairId would then stay null forever, so both
	// legs kept counting as real income and real spending, and legsInPairs
	// stopped any later run from re-proposing them.
	const proposedRows = await db
		.select({ outId: transferPair.outTransactionId, inId: transferPair.inTransactionId })
		.from(transferPair)
		.where(eq(transferPair.state, 'proposed'));
	const proposedLegs = new Set(proposedRows.flatMap((p) => [p.outId, p.inId]));
	const undecided = await db
		.select()
		.from(transaction)
		.where(and(isNull(transaction.categoryId), isNull(transaction.transferPairId)));
	for (const t of undecided) {
		if (t.reviewState === 'confirmed') continue;
		if (proposedLegs.has(t.id)) continue; // waiting on the transfer decision
		const decision = decideWithRules(
			{
				counterparty: t.counterparty,
				counterpartyAccount: t.counterpartyAccount,
				variableSymbol: t.variableSymbol,
				description: t.description,
				amountMinor: t.amount
			},
			rules,
			threshold
		);
		if (decision.kind === 'auto') {
			await db
				.update(transaction)
				.set({
					categoryId: decision.categoryId,
					suggestedCategoryId: null,
					reviewState: 'auto',
					reviewReason: null
				})
				.where(eq(transaction.id, t.id));
		} else if (
			t.reviewState !== 'needs_review' ||
			t.reviewReason !== decision.reason ||
			t.suggestedCategoryId !== decision.categoryId
		) {
			await db
				.update(transaction)
				.set({
					reviewState: 'needs_review',
					reviewReason: decision.reason,
					suggestedCategoryId: decision.categoryId
				})
				.where(eq(transaction.id, t.id));
		}
		// Tags are additive: every matching rule contributes, no conflict possible.
		if (decision.tagIds.length > 0) await addTagsToTransaction(t.id, decision.tagIds);
	}

	return paired;
}
