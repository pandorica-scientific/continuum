// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The broker report upload becomes a document (decision D8).
 *
 * Before this, `ingestBrokerFile` was the only upload in the product that
 * retained no file: the XTB workbook was read for its rows and then
 * discarded, so a re-read after a parser fix — or simply "where did this
 * figure come from" — had nothing to go back to. This files the same bytes
 * the ingest reads, on the Statements shelf, in the same transaction as the
 * ingest itself: a report whose ingest fails leaves no orphan document, and
 * a document never exists with no successful ingest behind it.
 */
import { extname } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { db, type Db, type Queryable } from '$lib/server/db';
import { account, document, documentType, shelf, tag, tagLink } from '$lib/server/db/schema';
import { hashBytes, saveUploadBytes } from '$lib/server/system/files';
import { insertDocumentAggregate } from '$lib/server/documents/mutations';
import { SYSTEM_SHELF_KEYS } from '$lib/documents/shelves';
import { systemShelfId } from '$lib/server/documents/shelves';
import { enqueueExtraction } from '$lib/server/documents/extract/queue';
import {
	archiveScopePredicate,
	visibleDocumentPredicate,
	type Actor
} from '$lib/server/documents/visibility';
import type { AboutDocument } from '$lib/server/documents/targets';
import { ingestReport, parseBrokerReport, type BrokerIngestResult } from './ingest';

/**
 * Hash the uploaded bytes, ingest the report, and file it as a document — in
 * one transaction, so a rolled-back ingest never leaves an orphan document
 * and a filed document never outlives the ingest it stands for.
 *
 * Idempotent on content: re-uploading the identical bytes reuses the
 * `broker_report` document already filed for them rather than minting a
 * second one (no second file, no second row). The ingest still runs on that
 * path — the broker's own operation ids are what make THAT idempotent — so
 * re-uploading an old report cannot silently stop updating the ledger just
 * because its document already exists.
 *
 * The existence check and the advisory lock guarding it both live INSIDE the
 * transaction, not before it. `document.content_hash` carries only a plain
 * index, not a unique constraint, so a check made before opening a
 * transaction — or one made inside it but without the lock — lets two
 * concurrent identical uploads (a double-click, two tabs) both read "nothing
 * exists yet" and both go on to save a file and insert a document. Locking
 * on the content hash serialises them: the second transaction blocks until
 * the first commits, then re-reads the row the first one just filed and
 * takes the reuse path instead. Same defence `import/ingest.ts` uses for
 * `import_file` (see its "Serialise the same body before checking the
 * unique content hash" comment).
 */
export async function uploadBrokerReport(
	fileName: string,
	bytes: Uint8Array,
	handle: Db = db
): Promise<BrokerIngestResult> {
	const contentHash = hashBytes(bytes);

	// Parsed once, up front, and reused on both branches below — CPU work with
	// no database involved, so it does not need to happen under the lock, and
	// doing it once here means neither branch has to parse the same workbook
	// a second time to get at the report it already has.
	const { id: brokerKey, label: brokerLabel, report } = parseBrokerReport(fileName, bytes);

	// Set only once a new document is actually about to be filed, never on the
	// reuse path — so the catch block below knows whether there is a
	// just-written file to warn about if everything after it rolls back.
	let storedName: string | null = null;
	let documentId: string | null = null;

	try {
		const result = await handle.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${`continuum:broker-report:${contentHash}`}, 0))`
			);

			// The check this whole lock exists for. Anything read before the lock
			// was acquired (there is nothing here) would be exactly the race this
			// guards against.
			const [existing] = await tx
				.select({ id: document.id })
				.from(document)
				.where(and(eq(document.type, 'broker_report'), eq(document.contentHash, contentHash)))
				.limit(1);

			if (existing) {
				// Nothing new to file — but the report is re-ingested anyway,
				// because a re-upload of an already-filed report is still how a
				// stale ledger gets caught up (dedup there runs on the broker's
				// own operation ids, not on this file's hash).
				const ingestResult = await ingestReport(report, tx);
				return { broker: brokerLabel, ...ingestResult };
			}

			// Only decided a new document is needed now, under the lock — so no
			// concurrent duplicate ever reaches this line. Keep the original
			// bytes on the data volume before writing anything else, the same
			// order every other writer uses.
			storedName = await saveUploadBytes(bytes, fileName);
			const ext = extname(fileName).replace(/^\./, '').toLowerCase() || 'xlsx';

			const ingestResult = await ingestReport(report, tx);

			// The day the report was generated, not the day it happens to be
			// uploaded (that is `addedOn` below). The fallback to today is
			// defensive rather than reachable in practice: `ingestReport` above
			// already refuses an unparseable `generatedAt` before this line runs.
			const generated = new Date(report.generatedAt);
			const reportDay = Number.isNaN(generated.getTime())
				? new Date().toISOString().slice(0, 10)
				: generated.toISOString().slice(0, 10);

			// The one brokerage account this report almost certainly belongs to —
			// but only when it is unambiguous. Zero means nothing to link yet;
			// more than one means guessing which one this report is for, which
			// a household with two brokerage accounts has to do itself by
			// attaching the document from the Accounts screen instead.
			const brokerageAccounts = await tx
				.select({ id: account.id })
				.from(account)
				.where(eq(account.kind, 'brokerage'));

			documentId = uuidv7();
			await insertDocumentAggregate(
				{
					id: documentId,
					name: `${brokerKey.toUpperCase()} report ${reportDay}`,
					shelfId: await systemShelfId(SYSTEM_SHELF_KEYS.statements, tx),
					type: 'broker_report',
					storedName,
					ext,
					addedOn: new Date().toISOString().slice(0, 10),
					expiresOn: null,
					expiryVerb: 'expires',
					contentHash,
					// The YEAR the report is about, which is the unit the coverage
					// ribbon draws yearly paper in. A broker's annual report covers a
					// year, not the day it happens to be generated on, and a report
					// dated to its generation day would sit in the wrong column the
					// moment a household downloads January's report in February.
					periodOn: `${reportDay.slice(0, 4)}-01-01`,
					periodEndOn: `${reportDay.slice(0, 4)}-12-31`,
					targetIds: brokerageAccounts.length === 1 ? [brokerageAccounts[0].id] : [],
					tagNames: [brokerKey, reportDay.slice(0, 4)]
				},
				tx
			);

			return { broker: brokerLabel, ...ingestResult };
		});

		// After the commit, never inside it: a queued job pointing at a document
		// the transaction went on to roll back is work with nothing to read.
		if (documentId) await enqueueExtraction(documentId, handle);
		return result;
	} catch (error) {
		// The transaction rolled back, so nothing — the document included — was
		// written. The file on disk cannot join that rollback: it is retained
		// rather than deleted, because a transient database failure must never
		// destroy the household's only copy of a report the broker may no
		// longer make easy to re-download. Only reachable when `storedName` was
		// actually set, i.e. the reuse branch never logs a phantom orphan.
		if (storedName) {
			console.warn(`Broker report upload ${storedName} retained as an orphan after rollback.`);
		}
		throw error;
	}
}

/**
 * Every `broker_report` document, visibility-checked — for when there is no
 * single brokerage account to key a `documentsAbout` lookup off (none filed
 * yet, or more than one account). Applies the same predicates
 * `documentsAbout` does, so a restricted report is exactly as invisible here
 * as it is everywhere else.
 */
export async function brokerReports(
	actor: Actor | null,
	handle: Queryable = db
): Promise<AboutDocument[]> {
	const rows = await handle
		.select({
			id: document.id,
			name: document.name,
			ext: document.ext,
			storedName: document.storedName,
			type: document.type,
			shelfKey: shelf.key,
			shelfLabel: shelf.label,
			expiresOn: document.expiresOn,
			expiryVerb: document.expiryVerb,
			addedOn: document.addedOn,
			sensitivity: document.sensitivity,
			reminderDays: documentType.reminderDays
		})
		.from(document)
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.innerJoin(documentType, eq(documentType.key, document.type))
		.where(
			and(
				eq(document.type, 'broker_report'),
				visibleDocumentPredicate(actor),
				archiveScopePredicate(false)
			)
		)
		.orderBy(document.name);

	if (rows.length === 0) return [];

	// A document's tags hang on its own entity row, so the target id of a tag
	// link IS the document id — the same join `documentsAbout` runs.
	const tagRows = await handle
		.select({ documentId: tagLink.targetId, name: tag.name })
		.from(tagLink)
		.innerJoin(tag, eq(tag.id, tagLink.tagId))
		.where(
			inArray(
				tagLink.targetId,
				rows.map((row) => row.id)
			)
		)
		.orderBy(tag.name);

	const tagsByDocument = new Map<string, string[]>();
	for (const row of tagRows) {
		tagsByDocument.set(row.documentId, [...(tagsByDocument.get(row.documentId) ?? []), row.name]);
	}

	return rows.map((row) => ({ ...row, tags: tagsByDocument.get(row.id) ?? [] }));
}
