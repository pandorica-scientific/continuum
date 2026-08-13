import { createHash, randomUUID } from 'node:crypto';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { account, importFile, person, transaction, transferPair } from '$lib/server/db/schema';
import { convertMinorSync, loadRateTable } from '$lib/server/fx/table';
import { decide } from '$lib/server/categorize';
import { categoryRule } from '$lib/server/db/schema';
import { detectAndParse } from './detect';
import { fingerprintAll } from './fingerprint';
import { normaliseAccountKey, proposePairs, type PairableTx } from './pairing';
import type { ParsedStatement } from './types';

export interface IngestResult {
	filename: string;
	bank?: string;
	rowsRead: number;
	rowsAdded: number;
	rowsDuplicate: number;
	rowsPaired: number;
	error?: string;
}

const BANK_LABEL: Record<string, string> = {
	fio: 'Fio',
	revolut: 'Revolut',
	mbank: 'mBank',
	rb: 'Raiffeisenbank',
	cs: 'Česká spořitelna'
};

async function resolveAccount(statement: ParsedStatement) {
	const accounts = await db.select().from(account);
	if (statement.accountNumber) {
		const key = normaliseAccountKey(statement.accountNumber);
		const byNumber = accounts.find((a) =>
			a.numbers.some((n) => normaliseAccountKey(n) === key || key.includes(normaliseAccountKey(n)))
		);
		if (byNumber) return byNumber;
	}
	const byBank = accounts.filter(
		(a) => a.bank === statement.bank && a.currency === statement.currency
	);
	if (byBank.length === 1) return byBank[0];

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
	return created;
}

/** Ingest one uploaded statement file end to end. */
export async function ingestFile(filename: string, buffer: Uint8Array): Promise<IngestResult> {
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
		} as IngestResult;
	}

	const acct = await resolveAccount(statement);
	const fileId = randomUUID();

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
		rowsRead: statement.rows.length
	});

	const newIds: string[] = [];
	for (let i = 0; i < statement.rows.length; i++) {
		const row = statement.rows[i];
		const id = randomUUID();
		const inserted = await db
			.insert(transaction)
			.values({
				id,
				accountId: acct.id,
				bookedAt: row.bookedAt,
				amount: row.amountMinor,
				currency: row.currency,
				counterparty: row.counterparty,
				counterpartyAccount: row.counterpartyAccount,
				variableSymbol: row.variableSymbol,
				description: row.description,
				bankRef: row.bankRef,
				dedupFingerprint: fingerprints[i],
				importFileId: fileId
			})
			.onConflictDoNothing({ target: [transaction.accountId, transaction.dedupFingerprint] })
			.returning({ id: transaction.id });
		if (inserted.length > 0) {
			added++;
			newIds.push(inserted[0].id);
		} else {
			duplicate++;
		}
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
 */
export async function pairAndCategorise(): Promise<number> {
	const accounts = await db.select().from(account);
	const people = await db.select({ name: person.name }).from(person);
	const rates = await loadRateTable();

	// Candidate legs: recent, unpaired.
	const horizon = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
	const candidates = await db
		.select()
		.from(transaction)
		.where(and(isNull(transaction.transferPairId), gte(transaction.bookedAt, horizon)));

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
			personNames: people.flatMap((p) => p.name.toLowerCase().split(/\s+/)),
			convert: (amount, from, to, day) => convertMinorSync(rates, amount, from, to, day)
		}
	);

	let paired = 0;
	for (const proposal of proposals) {
		const pairId = randomUUID();
		await db.insert(transferPair).values({
			id: pairId,
			outTransactionId: proposal.outId,
			inTransactionId: proposal.inId,
			state: proposal.confidence === 'auto' ? 'auto' : 'proposed'
		});
		const reviewState = proposal.confidence === 'auto' ? 'auto' : 'needs_review';
		const reviewReason =
			proposal.confidence === 'auto' ? null : 'looks like a transfer between your own accounts';
		for (const id of [proposal.outId, proposal.inId]) {
			await db
				.update(transaction)
				.set({ transferPairId: pairId, reviewState, reviewReason, categoryId: null })
				.where(eq(transaction.id, id));
		}
		paired += 2;
	}

	// Categorise whatever is new and not a transfer.
	const rules = await db.select().from(categoryRule);
	const undecided = await db
		.select()
		.from(transaction)
		.where(and(isNull(transaction.categoryId), isNull(transaction.transferPairId)));
	for (const t of undecided) {
		if (t.reviewState === 'confirmed') continue;
		const decision = decide(
			{
				counterparty: t.counterparty,
				counterpartyAccount: t.counterpartyAccount,
				variableSymbol: t.variableSymbol,
				amountMinor: t.amount
			},
			rules
		);
		if (decision.kind === 'auto') {
			await db
				.update(transaction)
				.set({ categoryId: decision.categoryId, reviewState: 'auto', reviewReason: null })
				.where(eq(transaction.id, t.id));
		} else if (t.reviewState !== 'needs_review' || t.reviewReason !== decision.reason) {
			await db
				.update(transaction)
				.set({ reviewState: 'needs_review', reviewReason: decision.reason })
				.where(eq(transaction.id, t.id));
		}
	}

	return paired;
}
