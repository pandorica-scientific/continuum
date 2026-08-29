// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
/**
 * Receipts filed against a transaction — the register's own read of
 * `documentsAbout`.
 *
 * Attaching and detaching went through `attachDocumentToTransaction` and
 * `detachDocumentFromTransaction` here until Task 16, which is when the
 * transactions screen moved onto the same `DocumentsCard` every other record
 * screen uses. Those two are gone: `targets.ts`'s `attachDocument` and
 * `detachDocument` replace them, visibility-checked in a way the
 * transaction-only versions were not — a member holding a restricted
 * document's id could otherwise attach it to a transaction they can see and
 * read it off the card from there.
 *
 * What stays is this one function. The register pages up to fifty rows and
 * needs a receipt count and its filed papers for every one of them at once;
 * `documentsAbout` answers for a single record, so this is that same read
 * rule in one query keyed by transaction rather than fifty round trips to ask
 * it fifty times.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db, type Queryable } from '$lib/server/db';
import { document, documentLink, shelf, tag, tagLink } from '$lib/server/db/schema';
import { visibleDocumentPredicate, type Actor } from '$lib/server/documents/visibility';
import type { AboutDocument } from '$lib/server/documents/targets';

/**
 * Attachments for a page of transactions, in one query, keyed by row id.
 *
 * Still one query, deliberately: a register page shows fifty rows, and asking
 * per row for the sake of reusing `documentsAbout` would be fifty round trips
 * to answer one screen. What is shared is the RULE, not the query — the same
 * `visibleDocumentPredicate` goes into this `where`, so a receipt a member may
 * not see is not in the result rather than filtered out of it afterwards.
 */
export async function loadTransactionDocuments(
	transactionIds: string[],
	actor: Actor | null,
	handle: Queryable = db
): Promise<Map<string, AboutDocument[]>> {
	const byTransaction = new Map<string, AboutDocument[]>();
	if (transactionIds.length === 0) return byTransaction;

	const rows = await handle
		.select({
			targetId: documentLink.targetId,
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
			sensitivity: document.sensitivity
		})
		.from(documentLink)
		.innerJoin(document, eq(documentLink.documentId, document.id))
		.innerJoin(shelf, eq(shelf.id, document.shelfId))
		.where(and(inArray(documentLink.targetId, transactionIds), visibleDocumentPredicate(actor)))
		.orderBy(document.name);

	if (rows.length === 0) return byTransaction;

	// A document's tags hang on its own entity row, so the target id of a tag
	// link IS the document id — the same second query `documentsAbout` runs,
	// keyed the same way, for the same reason: a card with eight documents on
	// it should cost two round trips, not nine.
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

	for (const { targetId, ...doc } of rows) {
		const list = byTransaction.get(targetId) ?? [];
		list.push({ ...doc, tags: tagsByDocument.get(doc.id) ?? [] });
		byTransaction.set(targetId, list);
	}
	return byTransaction;
}
