import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import {
	account,
	currencyRate,
	importFile,
	person,
	transaction,
	transactionFingerprintAlias,
	transactionSplit,
	transferPair
} from '$lib/server/db/schema';
import { convertMinorSync, type RateTable } from '$lib/server/fx/table';
import { decideWithRules } from '$lib/rules/match';
import { autoThreshold, loadRules } from '$lib/server/rules';
import { addTagsToTransaction } from '$lib/server/tags';
import { saveUpload } from '$lib/server/files';
import { formatMinor } from '$lib/money';
import { detectAndParseAll } from './detect';
import { PROOF_RANK, type ProofClass } from './proof';
import { loadProfiles } from './profiles';
import { FINGERPRINT_VERSION, fingerprintAll } from './fingerprint';
import {
	accountKeysMatch,
	canonicalAccountIdentity,
	normaliseAccountKey,
	proposePairs,
	type PairableTx
} from './pairing';
import type { ParsedRow, ParsedStatement } from './types';

interface LegacyRevolutIdentity {
	bookedAt: string;
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

function legacyRevolutKey(row: LegacyRevolutIdentity): string {
	return JSON.stringify([
		row.bookedAt,
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
	/** One entry per statement in the file; a CAMT or ABO export may hold many. */
	statements?: StatementOutcome[];
	error?: string;
}

const BANK_LABEL: Record<string, string> = {
	fio: 'Fio',
	revolut: 'Revolut',
	mbank: 'mBank',
	rb: 'Raiffeisenbank',
	cs: 'Česká spořitelna',
	// ABO names no issuer, so the format is the honest label. The user can
	// rename the account; inventing a bank would be a guess stored as fact.
	abo: 'Bank (ABO/GPC)'
};

type Resolution =
	{ kind: 'ok'; account: typeof account.$inferSelect } | { kind: 'ambiguous'; reason: string };

export type DatabaseHandle = Queryable;

export async function inTransaction<T>(
	handle: DatabaseHandle,
	operation: (tx: DatabaseHandle) => Promise<T>
): Promise<T> {
	const candidate = handle as Db;
	if (typeof candidate.transaction === 'function') {
		return candidate.transaction((tx) => operation(tx));
	}
	return operation(handle);
}

/**
 * Match the statement to an account. When the statement carries no account
 * number (Revolut) and more than one candidate exists, refuse and ask —
 * silently creating a fresh account would fragment the ledger and defeat
 * dedup, since the unique index is scoped per account.
 *
 * Identity comes from the account NUMBER, and from the issuer only when the
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
 * imported INTO an account whose bank and currency the user stated, and that
 * metadata is authoritative. What the document appears to say is corroboration.
 */
async function resolveAccount(
	statement: ParsedStatement,
	explicitAccountId: string | undefined,
	handle: DatabaseHandle
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
		// format it was read as, and comparing that against the account told the
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
		// two different readers, and dedup is scoped per account, so every
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
					'Several accounts share this bank, currency, and account number. Choose the intended account and upload again.'
			};
		}
	} else {
		// Nothing identifies this statement but its bank and currency, so the
		// issuer has to be evidence rather than the name of a file format. Two
		// unrelated banks whose statements were both read generically in EUR are
		// not the same account, and matching on `tabular` + EUR said they were.
		if (!statement.issuer) {
			return {
				kind: 'ambiguous',
				reason:
					'This statement prints no account number, and the file does not say which bank issued it — pick the account it belongs to.'
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
	// `other` is what the column's own comment reserves for that, and it is the
	// honest value: a format name is not a bank, and storing one produced an
	// account called `tabular EUR` and published it through /api/v1.
	const id = randomUUID();
	const label = statement.issuer ? (BANK_LABEL[statement.issuer] ?? statement.issuer) : 'Bank';
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
/**
 * The file is wrong, not merely unassignable. Nothing is written — content hash
 * included — so the corrected file can be uploaded again without looking like a
 * duplicate.
 */
class StatementRejected extends Error {}

class NeedsAccount extends Error {
	constructor(readonly result: IngestResult) {
		super(result.error ?? 'An account is needed.');
	}
}

/** What one statement inside an uploaded file did. */
export interface StatementOutcome {
	accountId: string | null;
	bank: string;
	currency: string;
	accountNumber?: string;
	periodStart?: string;
	periodEnd?: string;
	rowsRead: number;
	rowsAdded: number;
	rowsDuplicate: number;
	/** The statement could not be assigned to an account — the user must choose. */
	needsAccount?: boolean;
	error?: string;
}

/**
 * Resolve one statement to an account and write its rows. Runs inside the
 * file's transaction, once per statement — a CAMT export or an ABO file may
 * carry several, each with its own account, period and balances.
 */
async function ingestStatement(
	tx: DatabaseHandle,
	statement: ParsedStatement,
	fileId: string,
	explicitAccountId?: string
): Promise<StatementOutcome> {
	const base = {
		bank: statement.bank,
		currency: statement.currency,
		accountNumber: statement.accountNumber,
		periodStart: statement.periodStart,
		periodEnd: statement.periodEnd,
		rowsRead: statement.rows.length
	};

	const resolution = await resolveAccount(statement, explicitAccountId, tx);
	if (resolution.kind === 'ambiguous') {
		return {
			...base,
			accountId: null,
			rowsAdded: 0,
			rowsDuplicate: 0,
			needsAccount: true,
			error: resolution.reason
		};
	}

	let acct = resolution.account;
	assertChainStartsWhereTheAccountLeftOff(statement, acct);
	if (
		explicitAccountId &&
		statement.accountNumber &&
		!acct.numbers.includes(statement.accountNumber)
	) {
		const numbers = [...acct.numbers, statement.accountNumber];
		await tx.update(account).set({ numbers }).where(eq(account.id, acct.id));
		acct = { ...acct, numbers };
	}

	const fingerprints = fingerprintAll(statement.rows);
	let added = 0;
	let duplicate = 0;

	const knownFingerprints = new Set(
		(
			await tx
				.select({ fingerprint: transaction.dedupFingerprint })
				.from(transaction)
				.where(
					and(
						eq(transaction.accountId, acct.id),
						inArray(transaction.dedupFingerprint, fingerprints)
					)
				)
		).map((row) => row.fingerprint)
	);
	const knownAliases = new Map(
		(
			await tx
				.select({
					fingerprint: transactionFingerprintAlias.fingerprint,
					transactionId: transactionFingerprintAlias.transactionId
				})
				.from(transactionFingerprintAlias)
				.where(
					and(
						eq(transactionFingerprintAlias.accountId, acct.id),
						inArray(transactionFingerprintAlias.fingerprint, fingerprints)
					)
				)
		).map((row) => [row.fingerprint, row.transactionId] as const)
	);
	const usedLegacyIds = new Set(knownAliases.values());
	const legacyRevolut = new Map<string, string[]>();
	if (statement.bank === 'revolut') {
		const replayDays = [...new Set(statement.rows.map((row) => row.bookedAt))];
		const replayCurrencies = [...new Set(statement.rows.map((row) => row.currency))];
		const legacyRows = await tx
			.select({
				id: transaction.id,
				bookedAt: transaction.bookedAt,
				amountMinor: transaction.amount,
				currency: transaction.currency,
				bankRef: transaction.bankRef,
				counterpartyAccount: transaction.counterpartyAccount,
				counterparty: transaction.counterparty,
				description: transaction.description,
				balanceAfterMinor: transaction.balanceAfterMinor,
				variableSymbol: transaction.variableSymbol,
				constantSymbol: transaction.constantSymbol,
				specificSymbol: transaction.specificSymbol,
				originalAmountMinor: transaction.originalAmountMinor,
				originalCurrency: transaction.originalCurrency
			})
			.from(transaction)
			.where(
				and(
					eq(transaction.accountId, acct.id),
					eq(transaction.fingerprintVersion, 1),
					inArray(transaction.bookedAt, replayDays),
					inArray(transaction.currency, replayCurrencies),
					sql`not exists (
							select 1 from ${transactionFingerprintAlias} existing_alias
							where existing_alias.transaction_id = ${transaction.id}
						)`
				)
			)
			.orderBy(transaction.id);
		for (const legacy of legacyRows) {
			const key = legacyRevolutKey(legacy);
			const candidates = legacyRevolut.get(key) ?? [];
			candidates.push(legacy.id);
			legacyRevolut.set(key, candidates);
		}
	}

	for (let i = 0; i < statement.rows.length; i++) {
		const row = statement.rows[i];
		const currentFingerprint = fingerprints[i];
		if (knownFingerprints.has(currentFingerprint)) {
			duplicate++;
			continue;
		}
		const knownLegacyId = knownAliases.get(currentFingerprint);
		if (knownLegacyId) {
			usedLegacyIds.add(knownLegacyId);
			duplicate++;
			continue;
		}

		// V1 Revolut stored amount - fee but discarded the fee itself, so its
		// current fingerprint cannot be reconstructed by a SQL migration.
		// Replay supplies the missing fee: bind the v3 fingerprint to the
		// exact legacy source facts and keep the historical row untouched.
		if (statement.bank === 'revolut') {
			const fee = row.feeMinor ?? 0n;
			const key = legacyRevolutKey({ ...row, amountMinor: row.amountMinor - fee });
			const candidates = legacyRevolut.get(key);
			let legacyId = candidates?.shift();
			while (legacyId && usedLegacyIds.has(legacyId)) {
				legacyId = candidates?.shift();
			}
			if (legacyId) {
				await tx
					.insert(transactionFingerprintAlias)
					.values({ accountId: acct.id, fingerprint: currentFingerprint, transactionId: legacyId })
					.onConflictDoNothing({
						target: [transactionFingerprintAlias.accountId, transactionFingerprintAlias.fingerprint]
					});
				knownAliases.set(currentFingerprint, legacyId);
				usedLegacyIds.add(legacyId);
				duplicate++;
				continue;
			}
		}

		const inserted = await tx
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
				dedupFingerprint: currentFingerprint,
				fingerprintVersion: FINGERPRINT_VERSION,
				importFileId: fileId,
				// On the row itself, so it can answer for its own origin even after
				// the file it came from is re-parsed or superseded.
				sourceMethod: statement.provenance?.method,
				proofClass: statement.provenance?.proofClass
			})
			.onConflictDoNothing({ target: [transaction.accountId, transaction.dedupFingerprint] })
			.returning({ id: transaction.id });
		if (inserted.length > 0) {
			knownFingerprints.add(currentFingerprint);
			added++;
		} else duplicate++;
	}

	if (statement.closingBalanceMinor !== undefined && statement.periodEnd) {
		await tx
			.update(account)
			.set({ balanceMinor: statement.closingBalanceMinor, balanceAsOf: statement.periodEnd })
			.where(
				and(
					eq(account.id, acct.id),
					or(isNull(account.balanceAsOf), lte(account.balanceAsOf, statement.periodEnd))
				)
			);
	}

	return { ...base, accountId: acct.id, rowsAdded: added, rowsDuplicate: duplicate };
}

/**
 * A running balance chain proves everything except its own beginning.
 *
 * Every step follows from the one above it, so removing a movement from the
 * HEAD of a statement leaves a chain that still closes perfectly — and still
 * agrees with a printed closing balance, because the sum and the starting point
 * shift by the same amount. A printed OPENING balance catches it. Two of the
 * sampled banks print none: a Revolut export of 38 movements and a CaixaBank
 * statement of 140, which between them are most of the rows this product files
 * on chain proof alone.
 *
 * Nothing inside such a file can settle it. What can is the account: the balance
 * we last recorded is where the next statement must begin.
 *
 * The period cannot be used to establish adjacency, because a statement that
 * prints no opening balance usually prints no period either — both are then
 * derived from the rows, so deleting the first row moves the period start along
 * with it and the two always agree. The gap in TIME is what remains, and it is
 * measured from the last balance we hold to the first movement in the file.
 *
 * Beyond a month that gap is assumed to be a missing statement rather than a
 * missing row, and nothing is said. That is the honest limit of what an account
 * balance can prove: a hole in someone's statement history looks exactly like a
 * hole in one statement, and refusing the import would punish the wrong one.
 */
const ANCHOR_WINDOW_DAYS = 31;

function assertChainStartsWhereTheAccountLeftOff(
	statement: ParsedStatement,
	acct: typeof account.$inferSelect
): void {
	// A printed opening balance is its own anchor; the proof engine used it.
	if (statement.openingBalanceMinor !== undefined) return;
	if (acct.balanceMinor === null || acct.balanceAsOf === null) return;
	if (statement.rows.length === 0) return;

	const dates = statement.rows.map((row) => row.bookedAt).sort();
	const firstMovement = dates[0];
	// A statement that starts on or before the balance we hold is history being
	// filled in behind us, not the next instalment.
	if (firstMovement <= acct.balanceAsOf) return;
	const days =
		(Date.parse(`${firstMovement}T00:00:00Z`) - Date.parse(`${acct.balanceAsOf}T00:00:00Z`)) /
		86_400_000;
	if (days > ANCHOR_WINDOW_DAYS) return;

	// The chain may be listed either way round, so both ends are candidates for
	// its beginning; the proof engine has already established that one of them is.
	const net = (row: ParsedRow) => row.amountMinor - (row.feeMinor ?? 0n);
	const openings: bigint[] = [];
	for (const row of [statement.rows[0], statement.rows[statement.rows.length - 1]]) {
		if (row?.balanceAfterMinor !== undefined) openings.push(row.balanceAfterMinor - net(row));
	}
	if (openings.length === 0) return;
	if (openings.some((opening) => opening === acct.balanceMinor)) return;

	const gap = openings[0] - acct.balanceMinor;
	const size = formatMinor(gap < 0n ? -gap : gap, statement.currency);
	throw new StatementRejected(
		`This statement prints no opening balance, and its first movement starts ${size} ${statement.currency} away from where this account stood on ${acct.balanceAsOf}. Either a movement is missing from the beginning of the file, or an earlier statement has not been imported yet. Nothing has been imported.`
	);
}

/** Ingest one uploaded statement file end to end. */
export async function ingestFile(
	filename: string,
	buffer: Uint8Array,
	explicitAccountId?: string,
	handle: DatabaseHandle = db,
	/**
	 * Allow the page to be read as an image when its text layer cannot be
	 * proven. Rasterising and recognising a statement takes seconds per page, so
	 * only a caller that is not holding a request open may ask for it — in
	 * practice, the queue.
	 */
	options: { ocr?: boolean } = {}
): Promise<IngestResult> {
	const contentHash = createHash('sha256').update(buffer).digest('hex');

	const existing = await handle
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

	let statements: ParsedStatement[];
	try {
		// Layouts this household has already confirmed. A saved profile is what
		// stops the second statement from a bank asking the same question again.
		// Fetched only if the file turns out to need one.
		// The account states its currency, and when the person named one at upload
		// we know it before a byte is parsed. That is the authority — the document
		// is corroboration — and passing it here is what stops a statement whose
		// figures name no currency being refused for want of one, or worse, read
		// under a guess.
		//
		// Only the explicit case: an account resolved FROM the statement is not
		// known until after parsing, and for a first import there is no account to
		// ask. Both remain questions, which is the honest answer for them.
		const chosen = explicitAccountId
			? await handle.select().from(account).where(eq(account.id, explicitAccountId))
			: [];
		statements = await detectAndParseAll(buffer, {
			profiles: () => loadProfiles(handle),
			ocr: options.ocr,
			currency: chosen[0]?.currency
		});
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

	const totalRows = statements.reduce((n, s) => n + s.rows.length, 0);

	// A parse that found nothing is a parser problem, not an import. Recording
	// it would store the content hash and make the correct re-import — after a
	// sniffing or adapter fix — look like a duplicate forever, and resolving an
	// account below would mint one for a bank the user may not even have.
	if (totalRows === 0) {
		return {
			filename,
			bank: statements[0]?.bank,
			rowsRead: 0,
			rowsAdded: 0,
			rowsDuplicate: 0,
			rowsPaired: 0,
			error:
				'No transactions were found in this file, so nothing was imported. The file was not recorded — you can upload it again once the format is supported.'
		};
	}

	// An explicit account answers one question — "which account is THIS
	// statement for" — so it can only apply when the file holds one. A CAMT
	// export carrying three accounts must resolve each on its own evidence;
	// applying the choice to all three would file two of them into the wrong
	// account, which dedup cannot undo because the fingerprint is per account.
	const explicitAppliesTo = statements.length === 1 ? explicitAccountId : undefined;

	// Validate a user selection before writing the original file. The same
	// validation runs again in the transaction in case the account changes.
	if (explicitAppliesTo) {
		const preflightResolution = await resolveAccount(statements[0], explicitAppliesTo, handle);
		if (preflightResolution.kind === 'ambiguous') {
			return {
				filename,
				bank: statements[0].bank,
				rowsRead: totalRows,
				rowsAdded: 0,
				rowsDuplicate: 0,
				rowsPaired: 0,
				needsAccount: true,
				error: preflightResolution.reason
			};
		}
	}

	// Keep the original bytes on the data volume: parser improvements re-parse
	// stored files instead of asking for years of statements again.
	let storedName: string | null;
	try {
		storedName = await saveUpload(new File([buffer as BlobPart], filename));
	} catch {
		storedName = null; // unexpected extension — the import still proceeds
	}

	try {
		return await inTransaction(handle, async (tx) => {
			// Serialise the same body before checking the unique content hash. The
			// second uploader then gets the normal duplicate result instead of a
			// transaction-level unique violation.
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${`continuum:import-file:${contentHash}`}, 0))`
			);
			// The preflight duplicate check above is only an optimisation. Repeat it
			// inside the transaction so a racing upload cannot partially proceed.
			const duplicateFiles = await tx
				.select()
				.from(importFile)
				.where(eq(importFile.contentHash, contentHash));
			if (duplicateFiles.length > 0) {
				return {
					filename,
					bank: duplicateFiles[0].bank,
					rowsRead: duplicateFiles[0].rowsRead,
					rowsAdded: 0,
					rowsDuplicate: duplicateFiles[0].rowsRead,
					rowsPaired: 0,
					error: 'This exact file was already imported.'
				};
			}

			const fileId = randomUUID();
			// The file row must exist before any transaction references it. Its
			// account is filled in once the first statement resolves one — a file
			// holding several accounts has no single owner, and the transactions
			// carry their own account anyway.
			await tx.insert(importFile).values({
				id: fileId,
				filename,
				bank: statements[0].bank,
				format: statements[0].format,
				accountId: null,
				contentHash,
				storedName,
				rowsRead: totalRows
			});

			const outcomes: StatementOutcome[] = [];
			let added = 0;
			let duplicate = 0;
			let firstAccountId: string | null = null;

			for (const statement of statements) {
				const outcome = await ingestStatement(tx, statement, fileId, explicitAppliesTo);
				outcomes.push(outcome);
				added += outcome.rowsAdded;
				duplicate += outcome.rowsDuplicate;
				if (!firstAccountId && outcome.accountId) firstAccountId = outcome.accountId;
			}

			// Pair once, across every day any statement in this file touched, so a
			// transfer between two accounts in the SAME export pairs immediately.
			const paired = await pairAndCategorise(
				tx,
				pairingWindowAround(statements.flatMap((s) => s.rows.map((row) => row.bookedAt)))
			);
			// File-level evidence.
			//
			// A file usually holds one statement, and then this is simply that
			// statement's reading. When it holds several — a CAMT export, a
			// workbook — the figures belong to individual statements and recording
			// any one of them at file level would assert something untrue, so only
			// what is common to all of them is kept: how they were read, and the
			// WEAKEST proof among them, because a file is only as well evidenced as
			// its least evidenced part.
			const only = statements.length === 1 ? statements[0] : undefined;
			const weakest = statements.reduce<ParsedStatement | undefined>(
				(worst, candidate) =>
					!worst ||
					PROOF_RANK[(candidate.provenance?.proofClass ?? 'P0') as ProofClass] <
						PROOF_RANK[(worst.provenance?.proofClass ?? 'P0') as ProofClass]
						? candidate
						: worst,
				undefined
			);
			await tx
				.update(importFile)
				.set({
					accountId: firstAccountId,
					rowsAdded: added,
					rowsDuplicate: duplicate,
					rowsPaired: paired,
					sourceMethod: statements[0].provenance?.method,
					proofClass: weakest?.provenance?.proofClass,
					ledgerModel: only?.provenance?.ledgerModel,
					currency: only?.currency,
					openingBalanceMinor: only?.openingBalanceMinor,
					closingBalanceMinor: only?.closingBalanceMinor,
					statedCreditTotalMinor: only?.statedCreditTotalMinor,
					statedDebitTotalMinor: only?.statedDebitTotalMinor,
					statedRowCount: only?.statedRowCount,
					reconciliation: only?.provenance?.checks ?? null
				})
				.where(eq(importFile.id, fileId));

			const unresolved = outcomes.find((o) => o.needsAccount);
			if (unresolved) {
				throw new NeedsAccount({
					filename,
					bank: statements[0].bank,
					rowsRead: totalRows,
					rowsAdded: 0,
					rowsDuplicate: 0,
					rowsPaired: 0,
					statements: outcomes,
					needsAccount: true,
					error: unresolved.error
				});
			}

			return {
				filename,
				bank: statements[0].bank,
				rowsRead: totalRows,
				rowsAdded: added,
				rowsDuplicate: duplicate,
				rowsPaired: paired,
				statements: outcomes
			};
		});
	} catch (error) {
		// The transaction has rolled back, so nothing — importFile included — was
		// written; the user can choose an account and upload the same file again.
		if (error instanceof NeedsAccount) return error.result;
		if (error instanceof StatementRejected) {
			return {
				filename,
				bank: statements[0]?.bank,
				rowsRead: totalRows,
				rowsAdded: 0,
				rowsDuplicate: 0,
				rowsPaired: 0,
				error: error.message
			};
		}
		// Filesystem writes cannot join the database transaction. Retain the
		// UUID-named original as an explicitly logged orphan so a transient
		// database failure never destroys the user's only copy of a statement.
		if (storedName)
			console.warn(`Statement upload ${storedName} retained as an orphan after rollback.`);
		throw error;
	}
}

/**
 * Pair transfers and categorise every not-yet-decided transaction. Runs after
 * each file so cross-file pairs appear as soon as the second leg arrives.
 *
 * Only auto pairs (hard evidence) are excluded from the figures immediately;
 * review proposals stay in income/spending until the user confirms them.
 */
/** Inclusive ISO-day bounds a pairing pass may consider. */
export interface PairingWindow {
	from: string;
	to: string;
}

// Tier 3 pairs legs up to three days apart, so a week either side covers every
// tier with slack to spare.
const PAIRING_WINDOW_DAYS = 7;

function shiftDay(day: string, delta: number): string {
	const at = new Date(`${day}T00:00:00.000Z`);
	at.setUTCDate(at.getUTCDate() + delta);
	return at.toISOString().slice(0, 10);
}

/**
 * The span a pass has to read to pair anything that just changed.
 *
 * Without one, every filing, import and transfer decision row-locked and
 * compared the entire unpaired ledger: auto-categorised rows stay candidates
 * forever, so the set only grows, and proposePairs is a nested loop over it.
 * The horizon this replaces was anchored to today, which is why it had to go —
 * it silently stopped historical statements pairing at all. Anchoring to the
 * changed rows instead bounds the work without caring how old they are.
 */
export function pairingWindowAround(days: string[]): PairingWindow | null {
	const known = days.filter(Boolean).sort();
	if (known.length === 0) return null;
	return {
		from: shiftDay(known[0], -PAIRING_WINDOW_DAYS),
		to: shiftDay(known[known.length - 1], PAIRING_WINDOW_DAYS)
	};
}

export async function pairAndCategorise(
	handle: DatabaseHandle = db,
	window: PairingWindow | null = null
): Promise<number> {
	return inTransaction(handle, (tx) => pairAndCategoriseInTransaction(tx, window));
}

export async function lockTransferPairing(handle: DatabaseHandle): Promise<void> {
	// Every pairing pass takes this transaction-scoped lock before reading any
	// candidates. If opposite legs arrive in concurrent import transactions,
	// the second pass waits for the first commit and then sees both movements.
	await handle.execute(
		sql`select pg_advisory_xact_lock(hashtextextended('continuum:transfer-pairing', 0))`
	);
}

async function pairAndCategoriseInTransaction(
	handle: DatabaseHandle,
	window: PairingWindow | null = null
): Promise<number> {
	await lockTransferPairing(handle);

	const accounts = await handle.select().from(account);
	const people = await handle.select({ name: person.name }).from(person);
	const rateRows = await handle.select().from(currencyRate);
	const rates: RateTable = new Map();
	for (const row of rateRows) {
		const list = rates.get(row.code) ?? [];
		list.push({ day: row.day, rate: Number(row.rate) });
		rates.set(row.code, list);
	}
	for (const list of rates.values()) list.sort((a, b) => (a.day < b.day ? 1 : -1));

	// Candidate legs: unpaired and not already part of a pending proposal (else
	// every run would re-propose the same pairs). Do not use a wall-clock cutoff:
	// historical statement imports need the same exact-evidence pairing.
	const pendingPairs = await handle.select().from(transferPair);
	const legsInPairs = new Set(pendingPairs.flatMap((p) => [p.outTransactionId, p.inTransactionId]));
	const candidates = (
		await handle
			.select()
			.from(transaction)
			.where(
				and(
					isNull(transaction.transferPairId),
					sql`${transaction.reviewState} not in ('confirmed', 'filed')`,
					sql`not exists (
						select 1 from ${transactionSplit} split
						where split.transaction_id = ${transaction.id}
					)`,
					window ? gte(transaction.bookedAt, window.from) : undefined,
					window ? lte(transaction.bookedAt, window.to) : undefined
				)
			)
			.orderBy(asc(transaction.bookedAt), asc(transaction.id))
			.for('update')
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
			await handle.insert(transferPair).values({
				id: pairId,
				outTransactionId: proposal.outId,
				inTransactionId: proposal.inId,
				state: 'auto'
			});
			for (const id of [proposal.outId, proposal.inId]) {
				await handle
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
			await handle.insert(transferPair).values({
				id: pairId,
				outTransactionId: proposal.outId,
				inTransactionId: proposal.inId,
				state: 'proposed'
			});
			for (const id of [proposal.outId, proposal.inId]) {
				await handle
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
	const [rules, threshold] = await Promise.all([loadRules(handle), autoThreshold(handle)]);
	// Re-read the proposals rather than reuse the snapshot taken above: the loop
	// that just ran inserts proposals of its own, and a leg waiting on a
	// transfer decision must not be categorised out from under it. Against the
	// stale snapshot, a leg proposed in this very pass could match a rule, flip
	// to reviewState 'auto', and vanish from /import — which lists only
	// 'needs_review'. Its transferPairId would then stay null forever, so both
	// legs kept counting as real income and real spending, and legsInPairs
	// stopped any later run from re-proposing them.
	const undecided = await handle
		.select()
		.from(transaction)
		.where(and(isNull(transaction.categoryId), isNull(transaction.transferPairId)))
		.for('update');
	// Read proposals after claiming the undecided rows. The global lock excludes
	// another pairing pass, and waiting for ordinary row editors means their
	// committed state is visible before categorisation. Reading in the reverse
	// order would leave a commit window where a proposal can be missed.
	const proposedRows = await handle
		.select({ outId: transferPair.outTransactionId, inId: transferPair.inTransactionId })
		.from(transferPair)
		.where(eq(transferPair.state, 'proposed'));
	const proposedLegs = new Set(proposedRows.flatMap((p) => [p.outId, p.inId]));
	for (const t of undecided) {
		if (t.reviewState === 'confirmed') continue;
		if (proposedLegs.has(t.id)) continue; // waiting on the transfer decision
		const decision = decideWithRules(
			{
				counterparty: t.counterparty,
				counterpartyAccount: t.counterpartyAccount,
				variableSymbol: t.variableSymbol,
				description: t.description,
				amountMinor: t.amount,
				currency: t.currency
			},
			rules,
			threshold
		);
		if (decision.kind === 'auto') {
			await handle
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
			await handle
				.update(transaction)
				.set({
					reviewState: 'needs_review',
					reviewReason: decision.reason,
					suggestedCategoryId: decision.categoryId
				})
				.where(eq(transaction.id, t.id));
		}
		// Tags are additive: every matching rule contributes, no conflict possible.
		if (decision.tagIds.length > 0) await addTagsToTransaction(t.id, decision.tagIds, handle);
	}

	return paired;
}
