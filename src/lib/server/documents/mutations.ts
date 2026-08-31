// SPDX-License-Identifier: AGPL-3.0-or-later
import postgres from 'postgres';
import type { DocumentTypeKey, EnumValue } from '$lib/enums';
import { eq } from 'drizzle-orm';
import { db, type Db, type Queryable } from '$lib/server/db';
import { document, documentLink, documentText, tagLink } from '$lib/server/db/schema';
import { upsertTag } from '$lib/server/tags';
import { upsertSubjectByName } from './subjects';
import { hashBytes, removeUpload } from '$lib/server/system/files';
import { cancelQueuedExtraction, enqueueExtraction } from './extract/queue';

/**
 * Postgres codes seen for a delete blocked by a foreign key. A plain
 * `NO ACTION` foreign key reports `23503` (foreign_key_violation), but
 * `ON DELETE RESTRICT` — what `import_file.document_id` actually declares —
 * reports the more specific `23001` (restrict_violation). Both are matched,
 * together with the constraint name below, so an unrelated FK failure is
 * never mislabeled as "this is an import's statement".
 */
const FOREIGN_KEY_VIOLATION_CODES = new Set(['23503', '23001']);

/**
 * True only for the RESTRICT on `import_file.document_id` — never for any
 * other foreign key a `document` delete might trip (there is currently only
 * this one, but matching the constraint name by name, not just the error
 * code, keeps that true if another is ever added).
 *
 * Drizzle wraps the driver's own `PostgresError` in a `DrizzleQueryError`
 * before it reaches a caller, with the original as `.cause` — so that is
 * where the code and constraint name are read from, not off the error drizzle
 * actually throws.
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
	sensitivity?: EnumValue<'document.sensitivity'>;
	storedName: string | null;
	ext: string;
	addedOn: string;
	expiresOn: string | null;
	expiryVerb: EnumValue<'document.expiry_verb'>;
	/**
	 * Everything this document is filed against, by id, whatever kind each one
	 * turns out to be — the far end of a document link is an `entity`, so a
	 * person, a property, an account, a transaction and a subject all end up in
	 * the same insert regardless. Five per-kind lists used to sit here instead,
	 * one per caller's own vocabulary; every caller ever populated at most one
	 * of them at a time; one list is that same call written once.
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
	// One reading of the case-insensitive uniqueness rule, in `subjects.ts`
	// beside the rail's stricter `addSubject`. Typing "car" into capture when the
	// household already has a "Car" has to find that one, not fail and not mint a
	// second — and the lowercase comparison that decides it is now written once.
	if (input.newSubjectName) {
		wantedTargetIds.push(await upsertSubjectByName(input.newSubjectName, handle));
	}

	await handle.insert(document).values({
		id: input.id,
		name: input.name,
		shelfId: input.shelfId,
		type: input.type,
		note: input.note ?? null,
		sensitivity: input.sensitivity ?? 'normal',
		storedName: input.storedName,
		ext: input.ext,
		addedOn: input.addedOn,
		expiresOn: input.expiresOn,
		expiryVerb: input.expiryVerb,
		periodOn: input.periodOn ?? null,
		contentHash: input.contentHash ?? null
	});

	// Four inserts became one. The far end of a document link is an `entity`, so
	// what a target IS no longer decides which table the link goes in — which is
	// what stops a new module needing a document_<thing> table of its own.
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
 * Only the `document` row is deleted here. The AFTER DELETE trigger on the
 * table retires its `entity` row, and every link — document_link at both ends,
 * tag_link — carries ON DELETE CASCADE from there, so the connectors go with
 * it. Enumerating them in application code would be a second, quietly
 * divergent copy of a rule the database already enforces.
 *
 * The file is NOT unlinked here, and that is the point of the split: a caller
 * holding a transaction has to be able to do this step inside it and unlink
 * the bytes only once the transaction has committed. Unlinking mid-transaction
 * would leave a record pointing at a file that is no longer there the moment
 * anything after it rolled back.
 *
 * One document CANNOT be removed at all: the statement an accepted import
 * filed for itself. `import_file.document_id` carries ON DELETE RESTRICT, so
 * the DELETE below fails atomically — nothing is removed — and `refused: true`
 * comes back instead. There is no "detach it first" path to offer: imports are
 * permanent by design (acknowledging one only hides it, it never deletes), so
 * refusing is the whole rule. The failed statement leaves the surrounding
 * transaction unusable, which is correct: a caller that got this answer has
 * nothing left to do but roll back.
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
 * The file is unlinked after the row is gone, not before: a delete that fails
 * must not leave a record pointing at a file that is no longer there. Pass a
 * plain handle, not a transaction — inside one the row is not committed yet,
 * and `removeDocument` in `lifecycle.ts` is what a caller with a transaction
 * wants.
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
 * The record, its links and its tags stay; only the bytes change. Everything
 * read out of the old file goes with it — leaving the chunks would make the
 * document searchable by text it no longer contains, which is worse than not
 * being searchable at all — and a fresh extraction is queued.
 *
 * The queued job for the OLD file is cancelled here (`enqueueExtraction` does
 * it). A job already RUNNING cannot be cancelled and is not: it discovers at
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
