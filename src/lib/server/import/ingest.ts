// SPDX-License-Identifier: AGPL-3.0-or-later
import { uuidv7 } from 'uuidv7';
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db, inTransaction, type Db, type Queryable } from '$lib/server/db';
import {
	account,
	importFile,
	transaction,
	transactionFingerprintAlias
} from '$lib/server/db/schema';
import { extname } from 'node:path';
import { hashBytes, saveUpload } from '$lib/server/system/files';
import { insertDocumentAggregate } from '$lib/server/documents/mutations';
import { enqueueExtraction } from '$lib/server/documents/extract/queue';
import { systemShelfId } from '$lib/server/documents/shelves';
import { formatMinor } from '$lib/money';
import { detectAndParseAll } from './detect';
import { PROOF_RANK, type ProofClass } from './proof';
import { loadProfiles } from './profiles';
import { FINGERPRINT_VERSION, fingerprintAll } from './fingerprint';
import type { ParsedRow, ParsedStatement } from './types';
import { pairAndCategorise, pairingWindowAround } from './pairing-run';
import { BANK_LABEL, legacyRevolutKey, resolveAccount } from './account-resolution';

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
interface StatementOutcome {
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
	tx: Queryable,
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
				bookedOn: transaction.bookedOn,
				amountMinor: transaction.amountMinor,
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
					inArray(transaction.bookedOn, replayDays),
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
			// The boundary between the reader's vocabulary and the schema's: a
			// ParsedRow says `bookedAt` because that is what the bank printed, and
			// the stored column says `booked_on`.
			const key = legacyRevolutKey({
				...row,
				bookedOn: row.bookedAt,
				amountMinor: row.amountMinor - fee
			});
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
				id: uuidv7(),
				accountId: acct.id,
				bookedOn: row.bookedAt,
				valueOn: row.valueDate,
				amountMinor: row.amountMinor,
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
			.set({ balanceMinor: statement.closingBalanceMinor, balanceOn: statement.periodEnd })
			.where(
				and(
					eq(account.id, acct.id),
					or(isNull(account.balanceOn), lte(account.balanceOn, statement.periodEnd))
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
	if (acct.balanceMinor === null || acct.balanceOn === null) return;
	if (statement.rows.length === 0) return;

	const dates = statement.rows.map((row) => row.bookedAt).sort();
	const firstMovement = dates[0];
	// A statement that starts on or before the balance we hold is history being
	// filled in behind us, not the next instalment.
	if (firstMovement <= acct.balanceOn) return;
	const days =
		(Date.parse(`${firstMovement}T00:00:00Z`) - Date.parse(`${acct.balanceOn}T00:00:00Z`)) /
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
		`This statement prints no opening balance, and its first movement starts ${size} ${statement.currency} away from where this account stood on ${acct.balanceOn}. Either a movement is missing from the beginning of the file, or an earlier statement has not been imported yet. Nothing has been imported.`
	);
}

/**
 * What a filed statement is called on the shelf.
 *
 * Built from what the statement proved about itself rather than from the file
 * name, because bank exports are named things like
 * `account-statement_2026-07-01_2026-07-31_en_38c41c.csv`. The file name is the
 * fallback for a reading that could not say.
 */
function statementDocumentName(filename: string, statements: ParsedStatement[]): string {
	const [first] = statements;
	const period = first?.periodEnd ?? first?.periodStart;
	const bank = BANK_LABEL[first?.bank ?? ''] ?? first?.bank;
	if (!bank || !period) return filename;
	const month = new Date(`${period}T00:00:00Z`).toLocaleString('en-GB', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
	const account = first?.accountNumber;
	return account ? `${bank} · ${account} · ${month}` : `${bank} · ${month}`;
}

/** Bank, account and year — the three things somebody looks a statement up by. */
function statementDocumentTags(statements: ParsedStatement[]): string[] {
	const [first] = statements;
	const period = first?.periodEnd ?? first?.periodStart;
	return [
		BANK_LABEL[first?.bank ?? ''] ?? first?.bank,
		first?.accountNumber,
		period?.slice(0, 4)
	].filter((tag): tag is string => Boolean(tag));
}

/**
 * Ingest one uploaded statement file end to end.
 *
 * `handle` is `Db`, not the wider `Queryable` most of this module takes:
 * `enqueueExtraction` below runs after `inTransaction` returns, on the
 * strength of that having committed. A caller passing its own open
 * transaction here would make that call still be inside it — the type is
 * what keeps that from compiling rather than needing to be remembered.
 */
export async function ingestFile(
	filename: string,
	buffer: Uint8Array,
	explicitAccountId?: string,
	handle: Db = db,
	/**
	 * Allow the page to be read as an image when its text layer cannot be
	 * proven. Rasterising and recognising a statement takes seconds per page, so
	 * only a caller that is not holding a request open may ask for it — in
	 * practice, the queue.
	 */
	options: { ocr?: boolean } = {}
): Promise<IngestResult> {
	const contentHash = hashBytes(buffer);

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

	// Set only on the path that actually files a document — never on the
	// preflight duplicate return above the insert, and never on a path that
	// throws, since a rollback takes the row this would point at with it.
	let filedDocumentId: string | null = null;

	try {
		const result = await inTransaction(handle, async (tx) => {
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

			const fileId = uuidv7();
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
				rowsRead: totalRows,
				// Required since 0052: a filed statement must always carry a record of
				// what read it and how strongly it was proven. What is known here is
				// the first statement's own reading; the weakest across every statement
				// in the file is written once they have all been filed, below.
				currency: statements[0].currency,
				sourceMethod: statements[0].provenance?.method ?? 'unknown',
				proofClass: statements[0].provenance?.proofClass ?? 'P0'
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

			// File the statement where it can be found again.
			//
			// The bytes were always kept — `storedName` above — but nothing ever
			// surfaced them, so a statement you had imported was not a document you
			// could open. This creates a row pointing at that same file; it does not
			// copy anything.
			//
			// Only an ACCEPTED statement is filed. A refusal produced no ledger rows,
			// and putting an unreadable file on a shelf with nothing to say about it
			// is clutter rather than a record. A refusal never reaches this line: it
			// throws out of the reader long before the transaction opens.
			if (storedName) {
				filedDocumentId = uuidv7();
				await insertDocumentAggregate(
					{
						id: filedDocumentId,
						name: statementDocumentName(filename, statements),
						shelfId: await systemShelfId('statements', tx),
						type: 'bank_statement',
						storedName,
						ext: extname(filename).replace(/^\./, '').toLowerCase() || 'csv',
						addedOn: new Date().toISOString().slice(0, 10),
						expiresOn: null,
						expiryVerb: 'expires',
						// The same bytes already fingerprinted for `importFile` above —
						// the file and the document it is filed as are one upload, so
						// they carry one hash between them.
						contentHash,
						targetIds: firstAccountId ? [firstAccountId] : [],
						tagNames: statementDocumentTags(statements)
					},
					tx
				);

				// Tie the import to the document just filed for it, in the same
				// transaction. Before this, the two rows shared a file with nothing
				// keying one to the other, so deleting the document from the
				// Documents screen deleted the import's only original underneath it.
				// The column is ON DELETE RESTRICT: once this is set, that delete is
				// refused rather than silently losing the evidence behind every row
				// this import wrote (see `deleteDocument`).
				await tx
					.update(importFile)
					.set({ documentId: filedDocumentId })
					.where(eq(importFile.id, fileId));
			}

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
		// After the commit, never inside it: a queued job pointing at a document
		// the transaction went on to roll back is work with nothing to read.
		if (filedDocumentId) await enqueueExtraction(filedDocumentId, handle);
		return result;
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
