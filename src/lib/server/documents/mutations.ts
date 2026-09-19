// SPDX-License-Identifier: AGPL-3.0-or-later
import postgres from 'postgres';
import type { DocumentTypeKey, EnumValue } from '$lib/enums';
import { eq } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import { and } from 'drizzle-orm';
import { document, documentLink, documentText, lane, tag, tagLink } from '$lib/server/db/schema';
import { upsertTag } from '$lib/server/tags';
import { upsertSubjectByName } from './subjects';
import { hashBytes, removeUpload } from '$lib/server/system/files';
import { cancelQueuedExtraction, enqueueExtraction } from './extract/queue';
import { matchesLane } from '$lib/organisations/lane-match';

/**
 * Postgres codes for a delete blocked by a foreign key: `23503` for a plain
 * `NO ACTION` FK, `23001` for `ON DELETE RESTRICT` (what `import_file.document_id`
 * declares). Matched together with the constraint name so an unrelated FK
 * failure is never mislabeled.
 */
const FOREIGN_KEY_VIOLATION_CODES = new Set(['23503', '23001']);

/**
 * True only for the RESTRICT on `import_file.document_id`, matched by
 * constraint name (not just the error code) so a future FK stays distinguishable.
 *
 * Drizzle wraps the driver's `PostgresError` in a `DrizzleQueryError`, with
 * the original as `.cause` — code and constraint name are read from there.
 */
function isImportFileRestrict(error: unknown): boolean {
	const cause = error instanceof Error ? error.cause : undefined;
	return (
		cause instanceof postgres.PostgresError &&
		FOREIGN_KEY_VIOLATION_CODES.has(cause.code) &&
		(cause.constraint_name ?? '').includes('import_file_document_id')
	);
}

interface CreateDocumentInput {
	id: string;
	name: string;
	/**
	 * Resolved by the caller through `shelfIdByKey`/`systemShelfId`. A key never
	 * reaches this far: shelves are rows a household may rename or delete, and
	 * the id is what a document is actually filed against.
	 */
	shelfId: string;
	/** What kind of paper this is. Behaviour hangs off this, never off shelf. */
	type: DocumentTypeKey;
	note?: string | null;
	storedName: string | null;
	ext: string;
	addedOn: string;
	expiresOn: string | null;
	expiryVerb: EnumValue<'document.expiry_verb'>;
	/**
	 * Everything this document is filed against, by id. The far end of a
	 * document link is an `entity`, so a person, a property, an account, a
	 * transaction and a subject all end up in the same insert regardless.
	 */
	targetIds: string[];
	newSubjectName?: string;
	tagNames: string[];
	/**
	 * SHA-256 of the file's own bytes, from `hashBytes` — never computed here,
	 * because every writer already holds the bytes it just saved. Null for a
	 * metadata-only document, which has no bytes to fingerprint.
	 */
	contentHash?: string | null;
	/** The month a document is ABOUT, not the day it was filed. See `document.periodOn`. */
	periodOn?: string | null;
	/** The last day it covers, for a document that covers a span. See `period_end_on`. */
	periodEndOn?: string | null;
	/** Which country's paper this is, upper case. See `document.country`. */
	country?: string | null;
}

export async function createDocument(input: CreateDocumentInput, handle: Db = db): Promise<void> {
	await handle.transaction((tx) => insertDocumentAggregate(input, tx));
	// After the commit, never inside it: a queued job pointing at a document the
	// transaction went on to roll back is work with nothing to read.
	if (input.storedName) await enqueueExtraction(input.id, handle);
}

/**
 * Insert a complete document aggregate using the transaction a caller owns.
 *
 * Enqueues nothing: a job pointing at a row this transaction goes on to roll
 * back is work with nothing to read, so the CALLER asks for extraction once its
 * own transaction has actually committed.
 */
export async function insertDocumentAggregate(
	input: CreateDocumentInput,
	handle: Queryable
): Promise<void> {
	const wantedTargetIds = [...input.targetIds];
	// Case-insensitive: typing "car" when the household already has a "Car" must
	// find that one, not mint a second.
	if (input.newSubjectName) {
		// Lands on the shelf the document is filed to, so its card is offered there next time.
		wantedTargetIds.push(await upsertSubjectByName(input.newSubjectName, input.shelfId, handle));
	}

	await handle.insert(document).values({
		id: input.id,
		name: input.name,
		shelfId: input.shelfId,
		type: input.type,
		note: input.note ?? null,
		storedName: input.storedName,
		ext: input.ext,
		addedOn: input.addedOn,
		expiresOn: input.expiresOn,
		expiryVerb: input.expiryVerb,
		periodOn: input.periodOn ?? null,
		periodEndOn: input.periodEndOn ?? null,
		country: input.country ?? null,
		contentHash: input.contentHash ?? null
	});

	// The far end of a document link is an `entity`, so what a target IS never
	// decides which table the link goes in.
	const targetIds = [...new Set(wantedTargetIds)];
	if (targetIds.length > 0) {
		await handle
			.insert(documentLink)
			.values(targetIds.map((targetId) => ({ documentId: input.id, targetId })))
			.onConflictDoNothing();
	}

	for (const name of input.tagNames) {
		const resolved = await upsertTag(name, handle);
		await handle
			.insert(tagLink)
			.values({ tagId: resolved.id, targetId: input.id })
			.onConflictDoNothing();
	}
}

/**
 * Why the statement behind an accepted import cannot be deleted.
 *
 * Exported so the delete path and the removal that wraps it say one sentence
 * rather than two that happen to match today.
 */
export const IMPORT_STATEMENT_REFUSAL =
	'This is the statement behind an import; it stays with the import.';

/**
 * The DATABASE half of removing a document: the row and everything hanging off
 * it, and the name of the file that is now nobody's.
 *
 * Only the `document` row is deleted here — the AFTER DELETE trigger retires
 * its `entity` row, and every link cascades from there, so connectors aren't
 * enumerated in application code.
 *
 * The file is NOT unlinked here: a caller holding a transaction must be able
 * to do this step inside it and unlink the bytes only once committed.
 *
 * One document CANNOT be removed: the statement an accepted import filed for
 * itself. `import_file.document_id` carries ON DELETE RESTRICT, so the DELETE
 * fails atomically and `refused: true` comes back instead — imports are
 * permanent by design. The surrounding transaction is unusable afterward.
 */
export async function deleteDocumentRow(
	documentId: string,
	handle: Queryable = db
): Promise<{ ok: boolean; refused?: boolean; storedName: string | null }> {
	let row: { storedName: string | null } | undefined;
	try {
		[row] = await handle
			.delete(document)
			.where(eq(document.id, documentId))
			.returning({ storedName: document.storedName });
	} catch (error) {
		if (isImportFileRestrict(error)) return { ok: false, refused: true, storedName: null };
		throw error;
	}
	if (!row) return { ok: false, storedName: null };
	return { ok: true, storedName: row.storedName };
}

/**
 * Remove a document from the household entirely: the record, everything it was
 * linked to, and the uploaded file behind it.
 *
 * The file is unlinked after the row is gone, not before. Pass a plain
 * handle, not a transaction — `removeDocument` in `lifecycle.ts` is for a
 * caller with a transaction.
 */
export async function deleteDocument(
	documentId: string,
	handle: Db = db
): Promise<{ ok: boolean; removedFile: boolean; refused?: boolean }> {
	const outcome = await deleteDocumentRow(documentId, handle);
	if (!outcome.ok) {
		return { ok: false, removedFile: false, ...(outcome.refused ? { refused: true } : {}) };
	}
	const removedFile = outcome.storedName ? await removeUpload(outcome.storedName) : false;
	return { ok: true, removedFile };
}

/**
 * Put a different file behind the same document.
 *
 * The record, its links and its tags stay; only the bytes change. Old text
 * chunks are dropped — leaving them would make the document searchable by
 * text it no longer contains — and a fresh extraction is queued.
 *
 * A job already RUNNING for the old file is not cancelled: it discovers at
 * commit time that the bytes it read are no longer the document's, and writes
 * nothing.
 */
export async function replaceDocumentFile(
	documentId: string,
	file: { storedName: string; ext: string; bytes: Uint8Array },
	handle: Db = db
): Promise<{ ok: boolean; removedFile: boolean }> {
	const [previous] = await handle
		.select({ storedName: document.storedName })
		.from(document)
		.where(eq(document.id, documentId))
		.limit(1);
	if (!previous) return { ok: false, removedFile: false };

	await handle.transaction(async (tx) => {
		await tx
			.update(document)
			.set({
				storedName: file.storedName,
				ext: file.ext.toUpperCase(),
				contentHash: hashBytes(file.bytes)
			})
			.where(eq(document.id, documentId));
		// Cascades to the chunks: what was read out of the old file is not what
		// this document says any more.
		await tx.delete(documentText).where(eq(documentText.documentId, documentId));
		await cancelQueuedExtraction(documentId, tx);
	});

	await enqueueExtraction(documentId, handle);
	const removedFile = previous.storedName ? await removeUpload(previous.storedName) : false;
	return { ok: true, removedFile };
}

/**
 * Put a document in a lane on a card it is linked to, or back into history.
 *
 * The link is checked rather than assumed: a document not on the lane's card
 * cannot be in its lane, otherwise a payslip could close a cell on an
 * employer it was never filed against.
 *
 * `null` is history, a real answer, not an absence.
 */
export async function assignLane(
	documentId: string,
	laneId: string | null,
	handle: Queryable = db
): Promise<void> {
	if (laneId) {
		const [target] = await handle
			.select({ entityId: lane.entityId })
			.from(lane)
			.where(eq(lane.id, laneId))
			.limit(1);
		if (!target) throw new Error('No such lane.');
		const [link] = await handle
			.select({ documentId: documentLink.documentId })
			.from(documentLink)
			.where(
				and(eq(documentLink.documentId, documentId), eq(documentLink.targetId, target.entityId))
			)
			.limit(1);
		if (!link) throw new Error('The document is not linked to the card that lane is on.');
	}
	await handle.update(document).set({ laneId }).where(eq(document.id, documentId));
}

/**
 * Slot a freshly-filed document into a lane on its own, when there is only
 * one honest answer.
 *
 * Filing a document against a card and picking its lane are two different
 * moments in the inspector — the lane picker only exists once the card link
 * is already saved, which otherwise means every first filing sits in History
 * until a second, separate edit moves it. This closes that gap the moment
 * conditions are unambiguous, the same restraint `proposeFor` applies across
 * cards: a lane with no conditions never claims anything, and two lanes on
 * this card matching at once means only a person can say which one holds it,
 * so neither is touched and it stays in History.
 */
export async function autoAssignLane(
	targetId: string,
	documentId: string,
	handle: Queryable = db
): Promise<void> {
	const lanes = await handle
		.select({ id: lane.id, conditions: lane.conditions })
		.from(lane)
		.where(eq(lane.entityId, targetId));
	const usable = lanes.filter((l) => Array.isArray(l.conditions) && l.conditions.length > 0);
	if (usable.length === 0) return;

	const [doc] = await handle
		.select({ type: document.type, name: document.name })
		.from(document)
		.where(eq(document.id, documentId));
	if (!doc) return;
	const tagRows = await handle
		.select({ name: tag.name })
		.from(tagLink)
		.innerJoin(tag, eq(tag.id, tagLink.tagId))
		.where(eq(tagLink.targetId, documentId));

	const candidate = {
		id: documentId,
		name: doc.name,
		type: doc.type,
		tags: tagRows.map((t) => t.name)
	};
	const hits = usable.filter((l) => matchesLane(candidate, l.conditions));
	if (hits.length !== 1) return;
	await assignLane(documentId, hits[0].id, handle);
}
